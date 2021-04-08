import {
    ArrayTypeName,
    ASTNodeConstructor,
    ContractDefinition,
    DataLocation,
    ElementaryTypeName,
    EnumDefinition,
    FunctionDefinition,
    FunctionStateMutability,
    FunctionTypeName,
    FunctionVisibility,
    Literal,
    LiteralKind,
    Mapping,
    resolveByName,
    SourceUnit,
    StateVariableVisibility,
    StructDefinition,
    TypeName,
    UserDefinedTypeName,
    VariableDeclaration,
    VariableDeclarationStatement
} from "solc-typed-ast";
import { AnnotationMap, AnnotationMetaData, AnnotationTarget } from "../../instrumenter";
import { Logger } from "../../logger";
import { assert, pp, single, topoSort } from "../../util";
import { eq } from "../../util/struct_equality";
import {
    DatastructurePath,
    Range,
    SAddressLiteral,
    SAnnotation,
    SBinaryOperation,
    SBooleanLiteral,
    SConditional,
    SFunctionCall,
    SHexLiteral,
    SId,
    SIndexAccess,
    SLet,
    SMemberAccess,
    SNode,
    SNumber,
    SProperty,
    SResult,
    SStateVarProp,
    SStringLiteral,
    SUnaryOperation,
    SUserFunctionDefinition,
    VarDefSite
} from "../ast";
import {
    SAddressType,
    SArrayType,
    SBuiltinStructType,
    SBuiltinTypeNameType,
    SBytes,
    SFunctionSetType,
    SIntType,
    SMappingType,
    SPackedArrayType,
    SPointer,
    SString,
    SType,
    SUserDefinedType,
    SUserDefinedTypeNameType
} from "../ast/types";
import { SBoolType } from "../ast/types/bool";
import { SFixedBytes } from "../ast/types/fixed_bytes";
import { SFunctionType } from "../ast/types/function_type";
import { SIntLiteralType } from "../ast/types/int_literal";
import { SStringLiteralType } from "../ast/types/string_literal";
import { STupleType } from "../ast/types/tuple_type";
import { BuiltinAddressMembers, BuiltinSymbols } from "./builtins";
import { TypeEnv } from "./typeenv";

export class StateVarScope {
    constructor(
        public readonly target: VariableDeclaration,
        public readonly annotation: SStateVarProp
    ) {}
}
export type SScope =
    | SourceUnit[]
    | ContractDefinition
    | FunctionDefinition
    | SLet
    | SUserFunctionDefinition
    | StateVarScope;
export type STypingCtx = SScope[];

export function ppTypingCtx(ctx: STypingCtx): string {
    return ctx
        .map((entry) => {
            if (entry instanceof ContractDefinition) {
                return entry.name;
            }

            if (entry instanceof FunctionDefinition) {
                /**
                 * @todo Handle free function properly
                 */
                if (entry.vScope instanceof SourceUnit) {
                    return entry.name;
                }

                return `${entry.vScope.name}.${entry.name}`;
            }

            if (entry instanceof SLet) {
                return `<let>`;
            }

            return "<root>";
        })
        .join(",");
}

function getScopeOfType<T extends ContractDefinition | FunctionDefinition>(
    constr: ASTNodeConstructor<T>,
    ctx: STypingCtx
): T | undefined {
    for (let i = ctx.length - 1; i >= 0; i--) {
        const scope = ctx[i];
        if (scope instanceof constr) {
            return scope;
        }
    }

    return undefined;
}

export abstract class STypeError extends Error {
    abstract loc(): Range;
    public annotationMetaData!: AnnotationMetaData;
}

export class SGenericTypeError<T extends SNode> extends STypeError {
    public readonly node: T;

    constructor(msg: string, node: T) {
        super(msg);
        this.node = node;
    }
    loc(): Range {
        return this.node.requiredSrc;
    }
}

export class SNoField extends SGenericTypeError<SNode> {
    public readonly field: string;

    constructor(msg: string, expr: SNode, field: string) {
        super(msg, expr);
        this.field = field;
    }
}

export class SWrongType extends SGenericTypeError<SNode> {
    public readonly actualT: SType;

    constructor(msg: string, expr: SNode, actualT: SType) {
        super(msg, expr);

        this.actualT = actualT;
    }
}

export class SUnknownId extends SGenericTypeError<SId> {
    constructor(id: SId) {
        super(`Unknown identifier ${id.name}`, id);
    }
}

export class SMissingSolidityType extends SGenericTypeError<SNode> {
    constructor(expr: SNode) {
        super(`Expression "${expr.pp()}" is missing a solidity type`, expr);
    }
}

export class SExprCountMismatch extends SGenericTypeError<SNode> {
    constructor(msg: string, expr: SNode) {
        super(msg, expr);
    }
}

export abstract class SFunCallTypeError extends SGenericTypeError<SNode> {
    constructor(msg: string, call: SFunctionCall) {
        super(msg, call.callee);
    }
}

export class SUnresolvedFun extends SFunCallTypeError {}
export class SFunNoReturn extends SFunCallTypeError {}
export class SArgumentMismatch extends SFunCallTypeError {}
export class SDuplicateError extends SGenericTypeError<SNode> {
    public readonly original: SNode;

    constructor(msg: string, original: SNode, duplicate: SNode) {
        super(msg, duplicate);
        this.original = original;
    }
}

export class IncompatibleTypes extends STypeError {
    public readonly exprA: SNode;
    public readonly typeA: SType;
    public readonly exprB: SNode;
    public readonly typeB: SType;
    readonly src: Range;

    constructor(msg: string, exprA: SNode, typeA: SType, exprB: SNode, typeB: SType, src: Range) {
        super(msg);

        this.exprA = exprA;
        this.typeA = typeA;
        this.exprB = exprB;
        this.typeB = typeB;
        this.src = src;
    }

    loc(): Range {
        return this.src;
    }
}

export class SInvalidKeyword extends SGenericTypeError<SNode> {
    constructor(msg: string, node: SNode) {
        super(msg, node);
    }
}

/**
 * Given a variable name and a stack of scopes find the definition of this variable.
 *
 * @param name variable name
 * @param ctx stack of scopes in which we are looking for `name`'s defintion
 */
export function lookupVarDef(name: string, ctx: STypingCtx): VarDefSite | undefined {
    // Walk the scope stack down looking for the definition of v
    for (let i = ctx.length - 1; i >= 0; i--) {
        const scope = ctx[i];
        if (scope instanceof FunctionDefinition) {
            for (const param of scope.vParameters.vParameters) {
                if (param.name === name) {
                    return param;
                }
            }

            for (const param of scope.vReturnParameters.vParameters) {
                if (param.name === name) {
                    return param;
                }
            }
        } else if (scope instanceof ContractDefinition) {
            for (const base of scope.vLinearizedBaseContracts) {
                for (const v of base.vStateVariables) {
                    if (v.name === name) {
                        return v;
                    }
                }
            }
        } else if (scope instanceof SUserFunctionDefinition) {
            for (let paramIdx = 0; paramIdx < scope.parameters.length; paramIdx++) {
                const [param] = scope.parameters[paramIdx];

                if (param.name === name) {
                    return [scope, paramIdx];
                }
            }
        } else if (scope instanceof Array) {
            // No variable definitions at the global scope
            return undefined;
        } else if (scope instanceof StateVarScope) {
            const prop = scope.annotation;

            for (let i = 0; i < prop.datastructurePath.length; i++) {
                const element = prop.datastructurePath[i];

                if (element instanceof SId && element.name === name) {
                    return [scope, i];
                }
            }
        } else {
            for (let bindingIdx = 0; bindingIdx < scope.lhs.length; bindingIdx++) {
                const binding = scope.lhs[bindingIdx];

                if (binding.name === name) {
                    return [scope, bindingIdx];
                }
            }
        }
    }
    return undefined;
}

/**
 * Find and return the user-defined type name `name` in the typing context `ctx`. Return `undefined` if none is found.
 *
 * @param ctx typing context
 * @param name user-defined type name to lookup
 */
function resolveTypeDef(
    ctx: STypingCtx,
    name: string
): StructDefinition | EnumDefinition | ContractDefinition | undefined {
    for (let i = ctx.length; i >= 0; i--) {
        const scope = ctx[i];
        if (scope instanceof SLet || scope instanceof FunctionDefinition) {
            continue;
        }

        if (scope instanceof ContractDefinition) {
            // Check if this is a struct or enum defined on the current contract or one of its bases
            for (const base of scope.vLinearizedBaseContracts) {
                for (const def of (base.vStructs as Array<
                    StructDefinition | EnumDefinition
                >).concat(base.vEnums)) {
                    if (def.name === name) {
                        return def;
                    }
                }
            }
        }

        if (scope instanceof Array) {
            for (const sourceUnit of scope) {
                // Check if this is a globally defined struct or enum
                for (const def of (sourceUnit.vStructs as Array<
                    StructDefinition | EnumDefinition
                >).concat(sourceUnit.vEnums)) {
                    if (def.name === name) {
                        return def;
                    }
                }
            }

            // Finally check if this is a contract/library name
            for (const sourceUnit of scope) {
                // Check if this is a globally defined struct or enum
                for (const contract of sourceUnit.vContracts) {
                    if (contract.name === name) {
                        return contract;
                    }
                }
            }
        }
    }

    return undefined;
}

function getUserDefinedTypeFQName(
    def: ContractDefinition | StructDefinition | EnumDefinition
): string {
    return def.vScope instanceof ContractDefinition
        ? `${def.vScope.name}.${def.name}`
        : `${def.name}`;
}

/**
 * Convert a Solidity TypeName into an SType. Note that for reference types (arrays, structs, maps, bytes, strings) the generated
 * SType will not contain Pointers. This is due to the fact that a TypeName could be used in different storage locations.
 *
 * @param astT Solidity TypeName
 */
export function astTypeNameToSType(astT: TypeName): SType {
    if (astT instanceof ElementaryTypeName) {
        const name = astT.name.trim();

        if (name === "bool") {
            return new SBoolType();
        }

        const addressRE = /^address *(payable)?$/;

        let m = name.match(addressRE);

        if (m !== null) {
            return new SAddressType(astT.stateMutability === "payable");
        }

        const intLiteralRE = /^int_const *([0-9]*)$/;

        m = name.match(intLiteralRE);

        if (m !== null) {
            return new SIntLiteralType();
        }

        const intTypeRE = /^(u?)int([0-9]*)$/;

        m = name.match(intTypeRE);

        if (m !== null) {
            const signed = m[1] !== "u";
            const nBits = m[2] === "" ? 256 : parseInt(m[2]);

            return new SIntType(nBits, signed);
        }

        const bytesRE = /^bytes([0-9]+)$/;

        m = name.match(bytesRE);

        if (name == "byte" || m !== null) {
            const size = m !== null ? parseInt(m[1]) : 1;

            return new SFixedBytes(size);
        }

        if (name === "bytes" || name === "string") {
            return name === "bytes" ? new SBytes() : new SString();
        }

        throw new Error(`NYI converting elementary AST Type ${name}`);
    }

    if (astT instanceof ArrayTypeName) {
        const elT = astTypeNameToSType(astT.vBaseType);

        let size: number | undefined;

        if (astT.vLength !== undefined) {
            if (!(astT.vLength instanceof Literal && astT.vLength.kind == LiteralKind.Number)) {
                throw new Error(`NYI non-literal array type sizes`);
            }

            size = parseInt(astT.vLength.value);
        }

        return new SArrayType(elT, size);
    }

    if (astT instanceof UserDefinedTypeName) {
        const def = astT.vReferencedDeclaration;

        if (
            def instanceof StructDefinition ||
            def instanceof EnumDefinition ||
            def instanceof ContractDefinition
        ) {
            return new SUserDefinedType(getUserDefinedTypeFQName(def), def);
        }

        throw new Error(`NYI typecheckin of user-defined type ${def.print()}`);
    }

    if (astT instanceof FunctionTypeName) {
        // param.vType is always defined here. Even in 0.4.x can't have function declarations with `var` args
        const parameters = astT.vParameterTypes.vParameters.map((param) => astVarToSType(param));
        const returns = astT.vReturnParameterTypes.vParameters.map((param) => astVarToSType(param));

        return new SFunctionType(parameters, returns, astT.visibility, astT.stateMutability);
    }

    if (astT instanceof Mapping) {
        const keyT = astTypeNameToSType(astT.vKeyType);
        const valueT = astTypeNameToSType(astT.vValueType);

        return new SMappingType(keyT, valueT);
    }

    throw new Error(`NYI converting AST Type ${astT.print()} to SType`);
}

function getVarLocation(astV: VariableDeclaration, baseLoc?: DataLocation): DataLocation {
    if (astV.storageLocation !== DataLocation.Default) {
        return astV.storageLocation;
    }

    // State variable case - must be in storage
    if (astV.vScope instanceof ContractDefinition) {
        return DataLocation.Storage;
    }

    if (baseLoc !== undefined) {
        return baseLoc;
    }

    // Either function argument/return or local variables
    if (astV.vScope instanceof FunctionDefinition) {
        assert(
            !(astV.parent instanceof VariableDeclarationStatement),
            `Scribble shouldn't look at local vars`
        );
        // Function args/returns have default memory locations for public/internal and calldata for external.
        return astV.vScope.visibility === FunctionVisibility.External
            ? DataLocation.CallData
            : DataLocation.Memory;
    }

    throw new Error(`NYI variables with scope ${astV.vScope.print()}`);
}

/**
 * Given an SType `type` that doesn't contain Poitners (as returned by astTypeNameToSType) and a storage
 * location `toLocation`, specialize `type` to a concrete type that lives in `toLocation`.
 *
 * You can think of `type` as a type template, from which we return a concrete type specialized to a given location.
 *
 * @param type - type without pointers
 * @param toLocation - location where `type` should be concretized.
 */
function specializeType(type: SType, toLocation: DataLocation): SType {
    assert(!(type instanceof SPointer), `Unexpected pointer type ${type.pp()} in concretization.`);
    assert(!(type instanceof STupleType), `Unexpected tuple type ${type.pp()} in concretization.`);

    // bytes and string
    if (type instanceof SPackedArrayType) {
        return new SPointer(type, toLocation);
    }

    if (type instanceof SArrayType) {
        const concreteElT = specializeType(type.elementT, toLocation);
        return new SPointer(new SArrayType(concreteElT, type.size), toLocation);
    }

    if (type instanceof SUserDefinedType) {
        const def = type.definition;
        assert(
            def !== undefined,
            `Can't concretize user defined type ${type.pp()} with no corresponding definition.`
        );

        if (def instanceof ContractDefinition) {
            // Contracts are always concretized as storage poitners
            return new SPointer(type, DataLocation.Storage);
        }

        if (def instanceof StructDefinition) {
            // Contracts are always concretized as storage poitners
            return new SPointer(type, toLocation);
        }

        // Enums are a value type
        return type;
    }

    if (type instanceof SMappingType) {
        // Always treat map keys as in-memory copies
        const concreteKeyT = specializeType(type.keyType, DataLocation.Memory);
        // The result of map indexing is always a pointer to a value that lives in storage
        const concreteValueT = specializeType(type.valueType, DataLocation.Storage);
        // Maps always live in storage
        return new SPointer(new SMappingType(concreteKeyT, concreteValueT), DataLocation.Storage);
    }

    // TODO: What to do about string literals?
    // All other types are "value" types.
    return type;
}

/**
 * Given a type `type` specialized to a specific storage location, return the
 * original type template from which `type` can be generated.
 */
export function despecializeType(type: SType): SType {
    if (type instanceof SPointer) {
        return type.to;
    }

    if (type instanceof SArrayType) {
        return new SArrayType(despecializeType(type.elementT), type.size);
    }

    if (type instanceof SMappingType) {
        const genearlKeyT = despecializeType(type.keyType);
        const generalValueT = despecializeType(type.valueType);
        return new SMappingType(genearlKeyT, generalValueT);
    }

    return type;
}

export function astVarToSType(astV: VariableDeclaration, baseLoc?: DataLocation): SType {
    assert(
        astV.vType !== undefined,
        "Unsupported variable declaration without a type: " + astV.print()
    );

    const type = astTypeNameToSType(astV.vType);
    return specializeType(type, getVarLocation(astV, baseLoc));
}

function isInty(type: SType): boolean {
    return type instanceof SIntType || type instanceof SIntLiteralType;
}

/**
 * Sort `contracts` in topological order with respect to inheritance.
 */
function sortContracts(contracts: ContractDefinition[]): ContractDefinition[] {
    const order: Array<[ContractDefinition, ContractDefinition]> = [];
    for (const contract of contracts) {
        for (const base of contract.vLinearizedBaseContracts) {
            if (base === contract) continue;

            order.push([base, contract]);
        }
    }

    return topoSort(contracts, order);
}

export function tcUnits(
    units: SourceUnit[],
    annotMap: AnnotationMap,
    typeEnv: TypeEnv = new TypeEnv()
): void {
    let contracts: ContractDefinition[] = [];
    const ctx: STypingCtx = [units];

    const tcHelper = (
        annotationMD: AnnotationMetaData,
        ctx: STypingCtx,
        target: AnnotationTarget
    ): void => {
        try {
            tcAnnotation(annotationMD.parsedAnnot, ctx, target, typeEnv);
        } catch (e) {
            // Add the annotation metadata to the exception for pretty-printing
            if (e instanceof STypeError) {
                e.annotationMetaData = annotationMD;
            }

            throw e;
        }
    };

    // Gather all contracts. buildAnnotationsMap() checks that free
    // functions/file level constants don't have annotations so we can ignore them.
    for (const unit of units) {
        contracts.push(...unit.vContracts);
    }

    // Sort contracts in topological order of inheritance. This way
    // user-defined functions in base contracts are added to the type environment
    // before annotations in child contracts
    contracts = sortContracts(contracts);
    for (const contract of contracts) {
        ctx.push(contract);
        // First type-check contract-level annotations
        for (const contractAnnot of annotMap.get(contract) as AnnotationMetaData[]) {
            tcHelper(contractAnnot, ctx, contract);
        }

        // Next type-check any state var annotations
        for (const stateVar of contract.vStateVariables) {
            for (const svAnnot of annotMap.get(stateVar) as AnnotationMetaData[]) {
                // The if_updated scope is pushed on ctx inside tcAnnotation
                tcHelper(svAnnot, ctx, stateVar);
            }
        }

        // Finally type-check any function annotations
        for (const funDef of contract.vFunctions) {
            ctx.push(funDef);
            for (const funAnnot of annotMap.get(funDef) as AnnotationMetaData[]) {
                tcHelper(funAnnot, ctx, funDef);
            }
            ctx.pop();
        }
        ctx.pop();
    }
}

/**
 * Type-check a top-level annotation `annot` in a typing context `ctx`.
 */
export function tcAnnotation(
    annot: SAnnotation,
    ctx: STypingCtx,
    target: AnnotationTarget,
    typeEnv: TypeEnv = new TypeEnv()
): void {
    if (annot instanceof SProperty) {
        let predCtx;

        if (annot instanceof SStateVarProp) {
            assert(
                target instanceof VariableDeclaration,
                `Unexpected if_updated target: ${pp(target)}`
            );
            predCtx = [...ctx, new StateVarScope(target, annot)];
            assert(target.vType !== undefined, `State var ${target.name} is missing a type.`);

            // Check to make sure the datastructure path matches the type of the
            // underlying target state var
            locateElementType(target.vType, annot.datastructurePath);
        } else {
            predCtx = ctx;
        }

        const exprType = tc(annot.expression, predCtx, typeEnv);

        if (!(exprType instanceof SBoolType)) {
            throw new SWrongType(
                `${annot.type} expects an expression of type bool not ${exprType.pp()}`,
                annot.expression,
                exprType
            );
        }
    } else if (annot instanceof SUserFunctionDefinition) {
        const funScope = ctx[ctx.length - 1];
        if (!(funScope instanceof ContractDefinition)) {
            throw new SGenericTypeError(
                `User functions can only be defined on contract annotations at the moment.`,
                annot
            );
        }

        const existing = typeEnv.getUserFunction(funScope, annot.name.name);
        if (existing) {
            throw new SDuplicateError(
                `User function ${annot.name.name} already defined`,
                existing,
                annot
            );
        }

        const bodyType = tc(annot.body, [...ctx, annot], typeEnv);

        if (!isImplicitlyCastable(annot.body, bodyType, annot.returnType)) {
            throw new SWrongType(
                `User function ${
                    annot.name
                } declares return type ${annot.returnType.pp()} but returns ${bodyType.pp()}`,
                annot.body,
                bodyType
            );
        }

        typeEnv.defineUserFunction(funScope, annot);
    } else {
        throw new Error(`NYI type-checking of annotation ${annot.pp()}`);
    }
}

export function tc(expr: SNode, ctx: STypingCtx, typeEnv: TypeEnv = new TypeEnv()): SType {
    const cache = (expr: SNode, type: SType): SType => {
        Logger.debug(`tc: ${expr.pp()} :: ${type.pp()}`);

        typeEnv.define(expr, type);

        return type;
    };

    if (typeEnv.hasType(expr)) {
        return typeEnv.typeOf(expr);
    }

    if (expr instanceof SNumber) {
        return cache(expr, new SIntLiteralType());
    }

    if (expr instanceof SBooleanLiteral) {
        return cache(expr, new SBoolType());
    }

    if (expr instanceof SStringLiteral) {
        return cache(expr, new SStringLiteralType());
    }

    if (expr instanceof SHexLiteral) {
        return cache(expr, new SStringLiteralType());
    }

    if (expr instanceof SAddressLiteral) {
        return cache(expr, new SAddressType(true));
    }

    if (expr instanceof SId) {
        return cache(expr, tcId(expr, ctx, typeEnv));
    }

    if (expr instanceof SResult) {
        return cache(expr, tcResult(expr, ctx, typeEnv));
    }

    if (expr instanceof SUnaryOperation) {
        return cache(expr, tcUnary(expr, ctx, typeEnv));
    }

    if (expr instanceof SBinaryOperation) {
        return cache(expr, tcBinary(expr, ctx, typeEnv));
    }

    if (expr instanceof SConditional) {
        return cache(expr, tcConditional(expr, ctx, typeEnv));
    }

    if (expr instanceof SIndexAccess) {
        return cache(expr, tcIndexAccess(expr, ctx, typeEnv));
    }

    if (expr instanceof SMemberAccess) {
        return cache(expr, tcMemberAccess(expr, ctx, typeEnv));
    }

    if (expr instanceof SLet) {
        return cache(expr, tcLet(expr, ctx, typeEnv));
    }

    if (expr instanceof SFunctionCall) {
        return cache(expr, tcFunctionCall(expr, ctx, typeEnv));
    }

    if (expr instanceof SUserDefinedType) {
        assert(expr.definition !== undefined, `Type expression ${expr.pp()} is missing def`);

        return cache(expr, new SUserDefinedTypeNameType(expr.definition));
    }

    if (expr instanceof SType) {
        return cache(expr, new SBuiltinTypeNameType(expr));
    }

    throw new Error(`NYI type-checking of ${expr.pp()}`);
}

export class BuiltinTypeDetector {
    readonly matcher: RegExp;
    readonly processor: (matches: RegExpMatchArray) => SType | undefined;

    constructor(rx: RegExp, handler: (matches: RegExpMatchArray) => SType | undefined) {
        this.matcher = rx;
        this.processor = handler;
    }

    detect(name: string): SType | undefined {
        const matches = name.match(this.matcher);

        return matches === null ? undefined : this.processor(matches);
    }
}

export const BuiltinTypeDetectors: BuiltinTypeDetector[] = [
    new BuiltinTypeDetector(/^bool$/, () => new SBoolType()),
    new BuiltinTypeDetector(/^string$/, () => new SString()),
    new BuiltinTypeDetector(
        /^address( )*(payable)?$/,
        (matches) => new SAddressType(matches[2] !== "")
    ),
    new BuiltinTypeDetector(/^bytes([0-9]?[0-9]?)$/, (matches) => {
        if (matches[1] === "") {
            return new SBytes();
        }

        const width = parseInt(matches[1]);

        if (width < 1 || width > 32) {
            return undefined;
        }

        return new SFixedBytes(width);
    }),
    new BuiltinTypeDetector(/^byte$/, () => new SFixedBytes(1)),
    new BuiltinTypeDetector(/^(u)?int([0-9]?[0-9]?[0-9]?)$/, (matches) => {
        const isSigned = matches[1] !== "u";

        if (matches[2] === "") {
            return new SIntType(256, isSigned);
        }

        const width = parseInt(matches[2]);

        if (width % 8 !== 0 || width < 8 || width > 256) {
            return undefined;
        }

        return new SIntType(width, isSigned);
    })
];

function tcIdBuiltinType(expr: SId): SBuiltinTypeNameType | undefined {
    for (const detector of BuiltinTypeDetectors) {
        const type = detector.detect(expr.name);

        if (type) {
            return new SBuiltinTypeNameType(type);
        }
    }

    return undefined;
}

function tcIdBuiltin(expr: SId): SType | undefined {
    return BuiltinSymbols.get(expr.name);
}

/**
 * Given the type of some state variable `type`, a 'data-structure path' `path` find the path of the
 * element of the data structre pointed to by the data-structure path.
 */
function locateElementType(type: TypeName, path: DatastructurePath): SType {
    for (let i = 0; i < path.length; i++) {
        const element = path[i];

        if (element instanceof SId) {
            if (type instanceof ArrayTypeName) {
                type = type.vBaseType;
            } else if (type instanceof Mapping) {
                type = type.vValueType;
            } else {
                throw new Error(
                    `Mismatch between path ${pp(
                        path
                    )} and actual type at index ${i}: Expected indexable type but got ${pp(type)}`
                );
            }
        } else {
            if (
                !(
                    type instanceof UserDefinedTypeName &&
                    type.vReferencedDeclaration instanceof StructDefinition
                )
            ) {
                throw new Error(
                    `Mismatch between path ${pp(
                        path
                    )} and actual type at index ${i}: Expected struct but got ${pp(type)}`
                );
            }

            const structDef = type.vReferencedDeclaration;
            const field = single(
                structDef.vMembers.filter((def) => def.name === element),
                `Expected a single field with name ${element} on struct  ${pp(structDef)}`
            );

            assert(
                field.vType !== undefined,
                `Missing type on field ${field.name} of struct ${pp(structDef)}`
            );

            type = field.vType;
        }
    }

    return specializeType(astTypeNameToSType(type), DataLocation.Storage);
}

/**
 * Given the type of some state variable `type`, a 'data-structure path' `path`, and an index `idx` in that path that
 * corresponds to some index variable, find the type of that index variable.
 */
function locateKeyType(type: TypeName, idx: number, path: Array<SId | string>): SType {
    assert(idx < path.length, ``);

    const idxCompT = locateElementType(type, path.slice(0, idx));

    if (!(idxCompT instanceof SPointer)) {
        throw new Error(
            `Can't compute key type for field ${idx} in path ${pp(
                path
            )}: arrive at non-indexable type ${idxCompT.pp()}`
        );
    }

    if (idxCompT.to instanceof SArrayType) {
        return new SIntType(256, false);
    } else if (idxCompT.to instanceof SMappingType) {
        return idxCompT.to.keyType;
    } else {
        throw new Error(
            `Can't compute key type for field ${idx} in path ${pp(
                path
            )}: arrive at non-indexable type ${idxCompT.pp()}`
        );
    }
}

function tcIdVariable(expr: SId, ctx: STypingCtx, typeEnv: TypeEnv): SType | undefined {
    const def = lookupVarDef(expr.name, ctx);

    if (def === undefined) {
        return undefined;
    }

    expr.defSite = def;

    if (def instanceof VariableDeclaration) {
        if (def.vType === undefined) {
            throw new SMissingSolidityType(expr);
        }

        return astVarToSType(def);
    }

    const [defNode, bindingIdx] = def;

    if (defNode instanceof SLet) {
        const rhsT = tc(defNode.rhs, ctx, typeEnv);

        if (defNode.lhs.length > 1) {
            if (!(rhsT instanceof STupleType && rhsT.elements.length === defNode.lhs.length)) {
                throw new SExprCountMismatch(
                    `Wrong number of values for let bindings in ${defNode.pp()}. Expected ${
                        defNode.lhs.length
                    } values, instead got ${rhsT.pp()}`,
                    defNode
                );
            }

            return rhsT.elements[bindingIdx];
        }

        return rhsT;
    }

    if (defNode instanceof StateVarScope) {
        assert(
            defNode.target.vType !== undefined,
            `Expected target ${pp(defNode.target)} for if_updated to have a vType.`
        );

        return locateKeyType(
            defNode.target.vType,
            bindingIdx,
            defNode.annotation.datastructurePath
        );
    }

    // otherwise defNode is SUserFunctionDefinition
    return defNode.parameters[bindingIdx][1];
}

export function tcId(expr: SId, ctx: STypingCtx, typeEnv: TypeEnv): SType {
    if (expr.name === "this") {
        const contract = ctx[1] as ContractDefinition;

        expr.defSite = "this";

        return new SPointer(
            new SUserDefinedType(getUserDefinedTypeFQName(contract), contract),
            DataLocation.Storage
        );
    }

    // First try to TC the id as a builtin type
    let retT: SType | undefined = tcIdBuiltinType(expr);

    if (retT !== undefined) {
        return retT;
    }

    // Next try to TC the id as a variable
    retT = tcIdVariable(expr, ctx, typeEnv);

    if (retT !== undefined) {
        return retT;
    }

    // Next lets try to TC as a function name (note - can't be a public getter
    // as those only appear in MemberExpressions)
    const funDefs = resolveByName(
        ctx[1] as ContractDefinition,
        FunctionDefinition,
        expr.name,
        false
    );

    if (funDefs.length > 0) {
        expr.defSite = "function_name";

        return new SFunctionSetType(funDefs);
    }

    // Finally lets try to TC it as a type name
    const userDef = resolveTypeDef(ctx, expr.name);

    if (userDef !== undefined) {
        expr.defSite = "type_name";

        return new SUserDefinedTypeNameType(userDef);
    }

    retT = tcIdBuiltin(expr);

    if (retT !== undefined) {
        return retT;
    }

    // See if this is a user function
    const contractScope = getScopeOfType(ContractDefinition, ctx);
    if (contractScope !== undefined) {
        const userFun = typeEnv.getUserFunction(contractScope, expr.name);

        if (userFun !== undefined) {
            expr.defSite = userFun;
            return new SFunctionType(
                userFun.parameters.map(([, type]) => type),
                [userFun.returnType],
                FunctionVisibility.Internal,
                FunctionStateMutability.View
            );
        }
    }

    // If all fails, throw unknown id
    throw new SUnknownId(expr);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function tcResult(expr: SResult, ctx: STypingCtx, typeEnv: TypeEnv): SType {
    const scope = getScopeOfType(FunctionDefinition, ctx);

    if (!scope) {
        throw new SInvalidKeyword("You can only use $result in function annotations.", expr);
    }

    if (scope.vReturnParameters.vParameters.length === 0) {
        throw new SInvalidKeyword(
            `Cannot use $result in function ${scope.name} which doesn't return anything.`,
            expr
        );
    }

    if (scope.vReturnParameters.vParameters.length === 1) {
        const retT = scope.vReturnParameters.vParameters[0].vType;
        assert(retT !== undefined, `Internal error: return vars should always have a type.`);
        return astTypeNameToSType(retT);
    }

    return new STupleType(
        scope.vReturnParameters.vParameters.map((param) => {
            assert(
                param.vType !== undefined,
                `Internal error: return vars should always have a type.`
            );
            return astTypeNameToSType(param.vType);
        })
    );
}

export function tcUnary(expr: SUnaryOperation, ctx: STypingCtx, typeEnv: TypeEnv): SType {
    if (expr.op === "!") {
        const bool = new SBoolType();
        const innerT = tc(expr.subexp, ctx, typeEnv);
        if (!(innerT instanceof SBoolType)) {
            throw new SWrongType(
                `Operation '!' expectes bool not ${innerT.pp()} in ${expr.pp()}`,
                expr.subexp,
                innerT
            );
        }

        return bool;
    }

    if (expr.op === "-") {
        const innerT = tc(expr.subexp, ctx, typeEnv);
        if (innerT instanceof SIntLiteralType || innerT instanceof SIntType) {
            return innerT;
        }

        throw new SWrongType(
            `Operation '-' expectes int or int literal, not ${innerT.pp()} in ${expr.pp()}`,
            expr.subexp,
            innerT
        );
    }

    return tc(expr.subexp, ctx, typeEnv);
}

export function isImplicitlyCastable(expr: SNode, type: SType, to: SType): boolean {
    if (eq(type, to)) {
        return true;
    }

    if (type instanceof SIntLiteralType && to instanceof SIntType) {
        return true;
    }

    if (type instanceof SStringLiteralType && to instanceof SPointer && to.to instanceof SBytes) {
        return true;
    }

    if (type instanceof SStringLiteralType && to instanceof SPointer && to.to instanceof SString) {
        return true;
    }

    if (type instanceof SIntType && to instanceof SIntType) {
        return type.signed === to.signed && type.nBits <= to.nBits;
    }

    if (type instanceof SAddressType && to instanceof SAddressType) {
        return !to.payable;
    }

    // Allow implicit casts between calldata, storage and memory
    if (type instanceof SPointer && to instanceof SPointer && eq(type.to, to.to)) {
        return true;
    }

    return false;
}

/**
 * Given two expressions `exprA` and `exprB` with types `typeA` and `typeB` which are ints or int literals,
 * compute a common type to which these cast (if possible) or throw an error.
 *
 * @param exprA first expression
 * @param typeA first expression type
 * @param exprB second expression
 * @param typeB second expression type
 */
function unifyTypes(
    exprA: SNode,
    typeA: SType,
    exprB: SNode,
    typeB: SType,
    commonParent: SNode
): SType {
    if (isImplicitlyCastable(exprA, typeA, typeB)) {
        return typeB;
    }

    if (isImplicitlyCastable(exprB, typeB, typeA)) {
        return typeA;
    }

    throw new IncompatibleTypes(
        `Types of ${exprA.pp()} (${typeA.pp()}) and ${exprB.pp()} (${typeB.pp()}) are incompatible`,
        exprA,
        typeA,
        exprB,
        typeB,
        commonParent.src as Range
    );
}

/**
 * Compute the type of the binary operation `expr` or throw a type error.
 *
 * @param expr - binary operation
 * @param ctx - typing context
 * @param typeEnv - type map (for caching)
 */
export function tcBinary(expr: SBinaryOperation, ctx: STypingCtx, typeEnv: TypeEnv): SType {
    const lhsT = tc(expr.left, ctx, typeEnv);
    const rhsT = tc(expr.right, ctx, typeEnv);

    // Arithmetic binary expressions require the two types to be integer and implicitly castable to each other.
    if (expr.op === "**") {
        if (
            !(rhsT instanceof SIntType || rhsT instanceof SIntLiteralType) ||
            (rhsT instanceof SIntType && rhsT.signed) ||
            (expr.right instanceof SNumber && expr.right.num.lt(0))
        ) {
            throw new SWrongType(
                `Type of ${expr.right.pp()} (${rhsT.pp()}) incompatible with ${expr.op} operator.`,
                expr.right,
                rhsT
            );
        }

        if (!(lhsT instanceof SIntType || lhsT instanceof SIntLiteralType)) {
            throw new SWrongType(
                `Type of ${expr.left.pp()} (${lhsT.pp()}) incompatible with ${expr.op} operator.`,
                expr.left,
                lhsT
            );
        }

        return lhsT instanceof SIntLiteralType ? rhsT : lhsT;
    }

    if (["*", "%", "/", "+", "-"].includes(expr.op)) {
        if (!(lhsT instanceof SIntType || lhsT instanceof SIntLiteralType)) {
            throw new SWrongType(
                `Type of ${expr.left.pp()} (${lhsT.pp()}) incompatible with ${expr.op} operator.`,
                expr.left,
                lhsT
            );
        }

        if (!(rhsT instanceof SIntType || rhsT instanceof SIntLiteralType)) {
            throw new SWrongType(
                `Type of ${expr.right.pp()} (${rhsT.pp()}) incompatible with ${expr.op} operator.`,
                expr.right,
                rhsT
            );
        }

        return unifyTypes(expr.left, lhsT, expr.right, rhsT, expr);
    }

    // Bit shifts require that the lhs is integer, int constant or fixed bytes and that the rhs is an int or int literal
    if (["<<", ">>"].includes(expr.op)) {
        if (
            !(
                lhsT instanceof SIntType ||
                lhsT instanceof SIntLiteralType ||
                lhsT instanceof SFixedBytes
            )
        ) {
            throw new SWrongType(
                `Type of ${expr.right.pp()} (${lhsT.pp()}) incompatible with ${expr.op} operator.`,
                expr.right,
                lhsT
            );
        }

        if (!(rhsT instanceof SIntType || rhsT instanceof SIntLiteralType)) {
            throw new SWrongType(
                `Type of ${expr.right.pp()} (${rhsT.pp()}) incompatible with ${expr.op} operator.`,
                expr.right,
                rhsT
            );
        }

        return lhsT instanceof SIntLiteralType ? rhsT : lhsT;
    }

    // We restrict comparison operators to just ints/int literals
    if (["<", ">", "<=", ">="].includes(expr.op)) {
        if (
            !(
                lhsT instanceof SIntType ||
                lhsT instanceof SIntLiteralType ||
                lhsT instanceof SFixedBytes
            )
        ) {
            throw new SWrongType(
                `Type of ${expr.right.pp()} (${lhsT.pp()}) incompatible with ${expr.op} operator.`,
                expr.right,
                lhsT
            );
        }

        if (
            !(
                rhsT instanceof SIntType ||
                rhsT instanceof SIntLiteralType ||
                rhsT instanceof SFixedBytes
            )
        ) {
            throw new SWrongType(
                `Type of ${expr.right.pp()} (${rhsT.pp()}) incompatible with ${expr.op} operator.`,
                expr.right,
                rhsT
            );
        }

        // Make sure the two types unify
        unifyTypes(expr.left, lhsT, expr.right, rhsT, expr);
        return new SBoolType();
    }

    if (["==", "!="].includes(expr.op)) {
        // Equality operators allow for the same or implicitly castable types.
        unifyTypes(expr.left, lhsT, expr.right, rhsT, expr);
        return new SBoolType();
    }

    if (["|", "&", "^"].includes(expr.op)) {
        // Bitwise binary ops allow ints that can be implicitly converted to each other
        if (
            (lhsT instanceof SIntType ||
                lhsT instanceof SIntLiteralType ||
                lhsT instanceof SFixedBytes) &&
            (rhsT instanceof SIntType ||
                rhsT instanceof SIntLiteralType ||
                rhsT instanceof SFixedBytes)
        ) {
            return unifyTypes(expr.left, lhsT, expr.right, rhsT, expr);
        }

        throw new IncompatibleTypes(
            `Types ${lhsT.pp()} and ${rhsT.pp()} not compatible with binary operator ${
                expr.op
            } in ${expr.pp()}`,
            expr.left,
            lhsT,
            expr.right,
            rhsT,
            expr.src as Range
        );
    }

    if (["||", "&&", "==>"].includes(expr.op)) {
        if (!(lhsT instanceof SBoolType && rhsT instanceof SBoolType)) {
            throw new IncompatibleTypes(
                `Types ${lhsT.pp()} and ${rhsT.pp()} not compatible with binary operator ${
                    expr.op
                } in ${expr.pp()}`,
                expr.left,
                lhsT,
                expr.right,
                rhsT,
                expr.src as Range
            );
        }

        return new SBoolType();
    }

    throw new Error(`NYI typecheck for binary operator ${expr.op}`);
}

/**
 * Compute the type of the conditional `expr` or throw a type error.
 *
 * @param expr - binary operation
 * @param ctx - typing context
 * @param typeEnv - type map (for caching)
 */
export function tcConditional(expr: SConditional, ctx: STypingCtx, typeEnv: TypeEnv): SType {
    const condT = tc(expr.condition, ctx, typeEnv);
    const trueT = tc(expr.trueExp, ctx, typeEnv);
    const falseT = tc(expr.falseExp, ctx, typeEnv);

    if (!(condT instanceof SBoolType)) {
        throw new SWrongType(
            `Conditional expects boolean for ${expr.condition.pp()} not ${condT.pp()}`,
            expr.condition,
            condT
        );
    }

    return unifyTypes(expr.trueExp, trueT, expr.falseExp, falseT, expr);
}

export function tcIndexAccess(expr: SIndexAccess, ctx: STypingCtx, typeEnv: TypeEnv): SType {
    const baseT = tc(expr.base, ctx, typeEnv);
    const indexT = tc(expr.index, ctx, typeEnv);

    if (baseT instanceof SFixedBytes) {
        if (!isInty(indexT)) {
            throw new SWrongType(
                `Cannot index into ${expr.base.pp()} with ${expr.index.pp()} of type ${indexT.pp()}`,
                expr.index,
                indexT
            );
        }
        return new SIntType(8, false);
    }

    if (baseT instanceof SPointer) {
        const toT = baseT.to;

        if (toT instanceof SBytes) {
            if (!isInty(indexT)) {
                throw new SWrongType(
                    `Cannot index into ${expr.base.pp()} with ${expr.index.pp()} of type ${indexT.pp()}`,
                    expr.index,
                    indexT
                );
            }
            return new SFixedBytes(1);
        }

        if (toT instanceof SArrayType) {
            if (!isInty(indexT)) {
                throw new SWrongType(
                    `Cannot index into ${expr.base.pp()} with ${expr.index.pp()} of type ${indexT.pp()}`,
                    expr.index,
                    indexT
                );
            }
            return toT.elementT;
        }

        if (toT instanceof SMappingType) {
            if (!isImplicitlyCastable(expr.index, indexT, toT.keyType)) {
                throw new SWrongType(
                    `Cannot index into ${expr.base.pp()} with ${expr.index.pp()} of type ${indexT.pp()}`,
                    expr.index,
                    indexT
                );
            }
            return toT.valueType;
        }
    }
    throw new SWrongType(`Cannot index into the type ${baseT.pp()}`, expr, baseT);
}

export function tcMemberAccess(expr: SMemberAccess, ctx: STypingCtx, typeEnv: TypeEnv): SType {
    const baseT = tc(expr.base, ctx, typeEnv);

    if (baseT instanceof SBuiltinStructType) {
        const type = baseT.members.get(expr.member);

        if (type === undefined) {
            throw new SNoField(
                `Builtin struct "${expr.base.pp()}" does not have a member "${expr.member}"`,
                expr,
                expr.member
            );
        }

        return type;
    }

    if (baseT instanceof SPointer) {
        const baseLoc = baseT.location;
        const baseToT = baseT.to;

        if (baseToT instanceof SArrayType && expr.member === "length") {
            return new SIntType(256, false);
        }

        if (baseToT instanceof SUserDefinedType) {
            const rawDef = baseToT.definition;

            if (rawDef instanceof StructDefinition) {
                for (const rawDecl of rawDef.vMembers) {
                    if (expr.member === rawDecl.name) {
                        // rawDecl.vType is defined, as you can't put a `var x;` in a struct definition.
                        return astVarToSType(rawDecl, baseLoc);
                    }
                }

                throw new SNoField(
                    `Struct ${baseToT.name} doesn't have a field ${expr.member}`,
                    expr,
                    expr.member
                );
            }

            if (rawDef instanceof ContractDefinition) {
                const funDefs = resolveByName(rawDef, FunctionDefinition, expr.member, false);

                if (funDefs.length > 0) {
                    return new SFunctionSetType(funDefs);
                }

                for (const varDecl of rawDef.vStateVariables) {
                    if (
                        expr.member === varDecl.name &&
                        varDecl.visibility === StateVariableVisibility.Public
                    ) {
                        return new SFunctionSetType([varDecl]);
                    }
                }

                const type = BuiltinAddressMembers.get(expr.member);

                if (type) {
                    return type;
                }

                throw new SNoField(
                    `Contract ${baseToT.name} doesn't have a function, public state variable or address builtin member ${expr.member}`,
                    expr,
                    expr.member
                );
            }
        }
    }

    if (baseT instanceof SAddressType) {
        const type = BuiltinAddressMembers.get(expr.member);

        if (type === undefined) {
            throw new SNoField(
                `Address type expression ${expr.base.pp()} doesn't have a builtin member ${
                    expr.member
                }`,
                expr,
                expr.member
            );
        }

        return type;
    }

    if (
        baseT instanceof SUserDefinedTypeNameType &&
        baseT.definition instanceof ContractDefinition
    ) {
        // First check if this is a type name
        const type = resolveTypeDef([ctx[0], baseT.definition], expr.member);
        if (type !== undefined) {
            return new SUserDefinedTypeNameType(type);
        }

        // Next check if this is a Library.FunName
        const funDefs = resolveByName(baseT.definition, FunctionDefinition, expr.member, false);
        if (funDefs.length > 0) {
            return new SFunctionSetType(funDefs);
        }
    }

    if (baseT instanceof SUserDefinedTypeNameType && baseT.definition instanceof EnumDefinition) {
        const rawDef = baseT.definition;

        for (const enumVal of rawDef.vMembers) {
            if (enumVal.name === expr.member) {
                return new SUserDefinedType(getUserDefinedTypeFQName(rawDef), rawDef);
            }
        }
    }

    if (
        baseT instanceof SFunctionSetType &&
        expr.member === "selector" &&
        baseT.definitions.length === 1
    ) {
        return new SFixedBytes(4);
    }

    // Finally check if there is a `using for` declaration that binds a library to this type.
    const funs: Set<FunctionDefinition> = new Set();
    const generalBaseT = despecializeType(baseT);

    for (const base of (ctx[1] as ContractDefinition).vLinearizedBaseContracts) {
        for (const usingFor of base.vUsingForDirectives) {
            const libraryApplies =
                usingFor.vTypeName === undefined
                    ? true
                    : eq(astTypeNameToSType(usingFor.vTypeName), generalBaseT);

            if (libraryApplies) {
                const library = usingFor.vLibraryName.vReferencedDeclaration as ContractDefinition;
                library.vFunctions
                    .filter((fun) => fun.name === expr.member)
                    .forEach((funDef) => funs.add(funDef));
            }
        }
    }

    if (funs.size > 0) {
        return new SFunctionSetType([...funs], expr.base);
    }

    throw new SNoField(
        `Expression ${expr.base.pp()} of type ${baseT.pp()} doesn't have a field ${expr.member}`,
        expr.base,
        expr.member
    );
}

export function tcLet(expr: SLet, ctx: STypingCtx, typeEnv: TypeEnv): SType {
    // Make sure rhs tc's
    const rhsT = tc(expr.rhs, ctx, typeEnv);
    if (rhsT instanceof STupleType) {
        if (expr.lhs.length !== rhsT.elements.length) {
            throw new SExprCountMismatch(
                `Wrong number of let bindings: expected ${rhsT.elements.length} got ${expr.lhs.length}`,
                expr
            );
        }
    } else if (expr.lhs.length !== 1) {
        throw new SExprCountMismatch(
            `Wrong number of let bindings: expected 1 got ${expr.lhs.length}`,
            expr
        );
    }

    return tc(expr.in, ctx.concat(expr), typeEnv);
}

function getFunDefType(fun: FunctionDefinition): SFunctionType {
    return new SFunctionType(
        fun.vParameters.vParameters.map((param) => astVarToSType(param)),
        fun.vReturnParameters.vParameters.map((param) => astVarToSType(param)),
        fun.visibility,
        fun.stateMutability
    );
}

function matchArguments(
    arg: SNode[],
    argTs: SType[],
    callable: FunctionDefinition | SFunctionType
) {
    const funT = callable instanceof FunctionDefinition ? getFunDefType(callable) : callable;

    if (argTs.length !== funT.parameters.length) {
        return false;
    }

    for (let i = 0; i < funT.parameters.length; i++) {
        const formalT = funT.parameters[i];

        if (!isImplicitlyCastable(arg[i], argTs[i], formalT)) {
            return false;
        }
    }

    return true;
}

export function tcFunctionCall(expr: SFunctionCall, ctx: STypingCtx, typeEnv: TypeEnv): SType {
    const callee = expr.callee;

    /**
     * There are 4 semantic cases for a function call:
     *  - callee is a type (type cast). calleeT is either a SBuiltinTypeNameType or SUserDefinedTypeNameType
     *  - callee is a function identifier
     *  - callee is a user-defined function identifier
     *  - callee is a spec builtin/keyword (e.g. sum()) - to be implemented
     */
    const calleeT = tc(callee, ctx, typeEnv);

    // Type-cast to a built-in type
    if (calleeT instanceof SBuiltinTypeNameType) {
        expr.args.map((arg) => tc(arg, ctx, typeEnv));

        if (expr.args.length !== 1) {
            throw new SExprCountMismatch(
                `Type casts expect exactly 1 argument, not ${expr.pp()}.`,
                expr
            );
        }

        return specializeType(calleeT.type, DataLocation.Memory);
    }

    // Type-cast to a user-defined type
    if (calleeT instanceof SUserDefinedTypeNameType) {
        const argTs = expr.args.map((arg) => tc(arg, ctx, typeEnv));
        let loc: DataLocation;

        if (calleeT.definition instanceof StructDefinition) {
            // Struct constructor case
            loc = DataLocation.Memory;
        } else {
            // Type-casting case
            if (argTs.length !== 1) {
                throw new SExprCountMismatch(
                    `Type casts expect exactly 1 argument, not ${expr.pp()}.`,
                    expr
                );
            }

            loc =
                calleeT.definition instanceof ContractDefinition
                    ? DataLocation.Storage
                    : (argTs[0] as SPointer).location;
        }

        // If we are castng to contract, then the location is always storage.
        // Otherwise casting shouldn't change location.

        return new SPointer(
            new SUserDefinedType(getUserDefinedTypeFQName(calleeT.definition), calleeT.definition),
            loc
        );
    }

    // Function or public getter
    if (calleeT instanceof SFunctionSetType) {
        const args = [...expr.args];

        if (calleeT.defaultArg !== undefined) {
            args.unshift(calleeT.defaultArg);
        }

        const argTs = args.map((arg) => tc(arg, ctx, typeEnv));

        const matchingFunDefs = calleeT.definitions.filter(
            (fun) => fun instanceof FunctionDefinition && matchArguments(args, argTs, fun)
        );

        const matchingVarDefs = calleeT.definitions.filter(
            (fun) => fun instanceof VariableDeclaration && expr.args.length === 0
        );

        const matchingDefs = matchingFunDefs.concat(matchingVarDefs);

        if (matchingDefs.length === 0) {
            throw new SUnresolvedFun(
                `Provided arguments ${expr.pp()} don't match any of candidate functions:\n\n` +
                    calleeT.definitions
                        .map((def) =>
                            def instanceof FunctionDefinition
                                ? def.canonicalSignature
                                : def.getterCanonicalSignature
                        )
                        .join("\n"),
                expr
            );
        } else if (matchingDefs.length > 1) {
            // This is an internal error - shouldn't be encoutered by normal user operations.
            throw new Error(
                `Multiple functions / public getters match callsite ${expr.pp()}: ${calleeT.pp()}`
            );
        }

        const def = matchingDefs[0];
        // Narrow down the set of matching definitions in the callee's type.
        calleeT.definitions = [def];

        if (def instanceof FunctionDefinition) {
            // param.vType is defined, as you can't put a `var x,` in a function definition.
            const retTs = def.vReturnParameters.vParameters.map((param) => astVarToSType(param));

            if (retTs.length === 1) {
                return retTs[0];
            }

            if (retTs.length > 1) {
                return new STupleType(retTs);
            }

            throw new SFunNoReturn(`Function ${def.name} doesn't return a type`, expr);
        } else {
            if (def.vType instanceof UserDefinedTypeName) {
                throw new Error(`NYI public getters for ${def.vType.print()}`);
            }

            // def.vType is defined, as you can't put a `var x,` in a contract state var definition.
            return astVarToSType(def);
        }
    }

    // Builtin function
    if (calleeT instanceof SFunctionType) {
        const argTs = expr.args.map((arg) => tc(arg, ctx, typeEnv));
        if (!matchArguments(expr.args, argTs, calleeT)) {
            throw new SArgumentMismatch(
                `Invalid types of arguments in function call ${expr.pp()}`,
                expr
            );
        }

        const retTs = calleeT.returns;

        if (retTs.length === 1) {
            return retTs[0];
        }

        if (retTs.length > 1) {
            return new STupleType(retTs);
        }

        throw new SFunNoReturn(`Function type "${calleeT.pp()}" doesn't return a type`, expr);
    }

    throw new SWrongType(`Cannot call ${callee.pp()} of type ${calleeT.pp()}`, callee, calleeT);
}
