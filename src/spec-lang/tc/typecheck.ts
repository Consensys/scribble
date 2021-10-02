import { satisfies } from "semver";
import {
    AddressType,
    AnyResolvable,
    ArrayType,
    ArrayTypeName,
    ASTNode,
    ASTNodeConstructor,
    BoolType,
    BytesType,
    ContractDefinition,
    DataLocation,
    EnumDefinition,
    FixedBytesType,
    FunctionDefinition,
    FunctionStateMutability,
    FunctionType,
    FunctionVisibility,
    generalizeType,
    ImportDirective,
    IntLiteralType,
    IntType,
    Mapping,
    MappingType,
    ParameterList,
    PointerType,
    resolveAny,
    resolveByName,
    SourceUnit,
    specializeType,
    Statement,
    StatementWithChildren,
    StateVariableVisibility,
    StringLiteralType,
    StringType,
    StructDefinition,
    TupleType,
    TypeName,
    typeNameToTypeNode,
    TypeNameType,
    TypeNode,
    UserDefinedType,
    UserDefinedTypeName,
    VariableDeclaration,
    VariableDeclarationStatement
} from "solc-typed-ast";
import { AnnotationMap, AnnotationMetaData, AnnotationTarget } from "../../instrumenter";
import { Logger } from "../../logger";
import { assert, last, pp, single, topoSort } from "../../util";
import { eq } from "../../util/struct_equality";
import {
    BuiltinFunctions,
    DatastructurePath,
    Range,
    SAddressLiteral,
    SAnnotation,
    SBinaryOperation,
    SBooleanLiteral,
    SConditional,
    SForAll,
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
import { BuiltinAddressMembers, BuiltinSymbols } from "./builtins";
import { BuiltinStructType, FunctionSetType, ImportRefType } from "./internal_types";
import { TypeEnv } from "./typeenv";

export class StateVarScope {
    constructor(
        public readonly target: VariableDeclaration,
        public readonly annotation: SStateVarProp
    ) {}
}
export type SScope =
    | SourceUnit
    | ContractDefinition
    | FunctionDefinition
    | Statement
    | SLet
    | SUserFunctionDefinition
    | StateVarScope
    | SForAll
    | VariableDeclarationStatement;

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

export function getScopeOfType<T extends ContractDefinition | FunctionDefinition>(
    constr: ASTNodeConstructor<T>,
    ctx: STypingCtx
): T | undefined {
    if (ctx[0] instanceof constr) {
        return ctx[0];
    }

    return (ctx[0] as ASTNode).getClosestParentByType(constr);
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
    public readonly actualT: TypeNode;

    constructor(msg: string, expr: SNode, actualT: TypeNode) {
        super(msg, expr);

        this.actualT = actualT;
    }
}

export class SUnknownId extends SGenericTypeError<SId> {
    constructor(id: SId) {
        super(`Unknown identifier ${id.name}`, id);
    }
}

export class SInaccessibleForVersion extends SGenericTypeError<SNode> {
    public readonly compilerVersion: string;

    constructor(node: SNode, name: string, compilerVersion: string) {
        super(`${name} is not accessible in solidity version ${compilerVersion}`, node);

        this.compilerVersion = compilerVersion;
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
    public readonly typeA: TypeNode;
    public readonly exprB: SNode;
    public readonly typeB: TypeNode;
    readonly src: Range;

    constructor(
        msg: string,
        exprA: SNode,
        typeA: TypeNode,
        exprB: SNode,
        typeB: TypeNode,
        src: Range
    ) {
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

function resolveAnyOfType<T extends AnyResolvable>(
    name: string,
    scope: ASTNode,
    version: string,
    t: ASTNodeConstructor<T>
): T[] {
    // If the context is a VariableDecarationStatement we must be in the case of an
    // assert placed right before it. Therefore excluse the `VariableDeclarationStatemetn` itself from the scope.
    const inclusive = !(scope instanceof VariableDeclarationStatement);
    return [...resolveAny(name, scope, version, inclusive)].filter((x) => x instanceof t) as T[];
}

/**
 * Given a variable name and a stack of scopes find the definition of this variable.
 *
 * @param name variable name
 * @param ctx stack of scopes in which we are looking for `name`'s defintion
 */
function lookupVarDef(name: string, ctx: STypingCtx, version: string): VarDefSite | undefined {
    // Walk the scope stack down looking for the definition of v
    for (let i = ctx.length - 1; i >= 0; i--) {
        const scope = ctx[i];
        if (scope instanceof ASTNode) {
            const res = resolveAnyOfType(name, scope, version, VariableDeclaration);
            return res.length > 0 ? single(res) : undefined;
        } else if (scope instanceof SUserFunctionDefinition) {
            for (let paramIdx = 0; paramIdx < scope.parameters.length; paramIdx++) {
                const [param] = scope.parameters[paramIdx];

                if (param.name === name) {
                    return [scope, paramIdx];
                }
            }
        } else if (scope instanceof StateVarScope) {
            const prop = scope.annotation;

            for (let i = 0; i < prop.datastructurePath.length; i++) {
                const element = prop.datastructurePath[i];

                if (element instanceof SId && element.name === name) {
                    return [scope, i];
                }
            }
        } else if (scope instanceof SForAll) {
            if (scope.iteratorVariable.name == name) {
                return scope;
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
 * Lookup any function definition(s) of name `name` in `STypeingCtx` `ctx`. Requires `version` to be
 * able to pass on to `resolveAny`.
 */
function lookupFun(name: string, ctx: STypingCtx, version: string): FunctionDefinition[] {
    const scope = ctx[0];
    assert(scope instanceof ASTNode, `Expected root scope to be an ASTNode, not ${scope}`);
    const res = resolveAnyOfType(name, scope, version, FunctionDefinition);
    return res as FunctionDefinition[];
}

/**
 * Find and return the user-defined type name `name` in the typing context `ctx`. Return `undefined` if none is found.
 *
 * @param ctx typing context
 * @param name user-defined type name to lookup
 */
function lookupTypeDef(
    name: string,
    ctx: STypingCtx,
    version: string
): StructDefinition | EnumDefinition | ContractDefinition | undefined {
    const scope = ctx[0];
    assert(scope instanceof ASTNode, `Expected root scope to be an ASTNode, not ${scope}`);
    const res = [...resolveAny(name, scope, version, true)].filter(
        (x) =>
            x instanceof StructDefinition ||
            x instanceof EnumDefinition ||
            x instanceof ContractDefinition
    ) as Array<StructDefinition | EnumDefinition | ContractDefinition>;

    return res.length > 0 ? single(res) : undefined;
}

function mkUserDefinedType(
    def: ContractDefinition | StructDefinition | EnumDefinition
): UserDefinedType {
    const name =
        def.vScope instanceof ContractDefinition ? `${def.vScope.name}.${def.name}` : `${def.name}`;
    return new UserDefinedType(name, def);
}

function getVarLocation(astV: VariableDeclaration, baseLoc?: DataLocation): DataLocation {
    if (astV.storageLocation !== DataLocation.Default) {
        return astV.storageLocation;
    }

    const scope = astV.vScope;

    // State variable case - must be in storage
    if (scope instanceof ContractDefinition) {
        return DataLocation.Storage;
    }

    if (baseLoc !== undefined) {
        return baseLoc;
    }

    // Either function argument/return or local variables
    if (scope instanceof FunctionDefinition && astV.parent instanceof ParameterList) {
        // Function args/returns have default memory locations for public/internal and calldata for external.
        return scope.visibility === FunctionVisibility.External
            ? DataLocation.CallData
            : DataLocation.Memory;
    }

    if (astV.parent instanceof VariableDeclarationStatement) {
        return DataLocation.Memory;
    }

    if (scope instanceof SourceUnit) {
        return DataLocation.Memory;
    }

    throw new Error(`NYI variables with scope ${scope.print()} for var ${astV.name}`);
}

export function astVarToTypeNode(astV: VariableDeclaration, baseLoc?: DataLocation): TypeNode {
    assert(
        astV.vType !== undefined,
        "Unsupported variable declaration without a type: " + astV.print()
    );

    const type = typeNameToTypeNode(astV.vType);
    return specializeType(type, getVarLocation(astV, baseLoc));
}

function isInty(type: TypeNode): boolean {
    return type instanceof IntType || type instanceof IntLiteralType;
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

    return order.length > 0 ? topoSort(contracts, order) : contracts;
}

export function tcUnits(units: SourceUnit[], annotMap: AnnotationMap, typeEnv: TypeEnv): void {
    let contracts: ContractDefinition[] = [];
    let targets: AnnotationTarget[] = [];

    // First gather all the targets
    for (const unit of units) {
        for (const child of unit.getChildrenBySelector(
            (node) =>
                (node instanceof FunctionDefinition && node.vScope instanceof ContractDefinition) ||
                node instanceof ContractDefinition ||
                (node instanceof VariableDeclaration && node.stateVariable) ||
                node instanceof Statement ||
                node instanceof StatementWithChildren
        )) {
            const target = child as AnnotationTarget;
            const annots = annotMap.get(target);

            // We include all contracts so that we can perform the topo sort (as it may depend on contracts without annotations)
            if (target instanceof ContractDefinition) {
                contracts.push(target);
            } else {
                if (annots !== undefined && annots.length > 0) {
                    targets.push(target);
                }
            }
        }
    }

    // Sort contracts topologically and prepend them to targets
    contracts = sortContracts(contracts);
    targets = [...contracts, ...targets];

    // Walk over all targets, and TC the annotations for each target
    for (const target of targets) {
        const typingCtx: STypingCtx = [
            target instanceof VariableDeclaration ? (target.vScope as ContractDefinition) : target
        ];
        const annotations = annotMap.get(target) as AnnotationMetaData[];

        for (const annotationMD of annotations) {
            try {
                tcAnnotation(annotationMD.parsedAnnot, typingCtx, target, typeEnv);
            } catch (e) {
                // Add the annotation metadata to the exception for pretty-printing
                if (e instanceof STypeError) {
                    e.annotationMetaData = annotationMD;
                }

                throw e;
            }
        }
    }
}

/**
 * Type-check a top-level annotation `annot` in a typing context `ctx`.
 */
export function tcAnnotation(
    annot: SAnnotation,
    ctx: STypingCtx,
    target: AnnotationTarget,
    typeEnv: TypeEnv
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

        if (!(exprType instanceof BoolType)) {
            throw new SWrongType(
                `${annot.type} expects an expression of type bool not ${exprType.pp()}`,
                annot.expression,
                exprType
            );
        }
    } else if (annot instanceof SUserFunctionDefinition) {
        const funScope = last(ctx);
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

        if (!isImplicitlyCastable(bodyType, annot.returnType)) {
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

export function tc(expr: SNode, ctx: STypingCtx, typeEnv: TypeEnv): TypeNode {
    const cache = (expr: SNode, type: TypeNode): TypeNode => {
        Logger.debug(`tc: ${expr.pp()} :: ${type.pp()}`);

        typeEnv.define(expr, type);

        return type;
    };

    if (typeEnv.hasType(expr)) {
        return typeEnv.typeOf(expr);
    }

    if (expr instanceof SNumber) {
        return cache(expr, new IntLiteralType());
    }

    if (expr instanceof SBooleanLiteral) {
        return cache(expr, new BoolType());
    }

    if (expr instanceof SStringLiteral) {
        return cache(expr, new StringLiteralType(expr.val, false));
    }

    if (expr instanceof SHexLiteral) {
        return cache(expr, new StringLiteralType(expr.val, true));
    }

    if (expr instanceof SAddressLiteral) {
        return cache(expr, new AddressType(true));
    }

    if (expr instanceof SId) {
        return cache(expr, tcId(expr, ctx, typeEnv));
    }

    if (expr instanceof SResult) {
        return cache(expr, tcResult(expr, ctx));
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

    if (expr instanceof TypeNode) {
        return new TypeNameType(expr);
    }

    if (expr instanceof SForAll) {
        return cache(expr, tcForAll(expr, ctx, typeEnv));
    }

    throw new Error(`NYI type-checking of ${expr.pp()}`);
}

export class BuiltinTypeDetector {
    readonly matcher: RegExp;
    readonly processor: (matches: RegExpMatchArray) => TypeNode | undefined;

    constructor(rx: RegExp, handler: (matches: RegExpMatchArray) => TypeNode | undefined) {
        this.matcher = rx;
        this.processor = handler;
    }

    detect(name: string): TypeNode | undefined {
        const matches = name.match(this.matcher);

        return matches === null ? undefined : this.processor(matches);
    }
}

export const BuiltinTypeDetectors: BuiltinTypeDetector[] = [
    new BuiltinTypeDetector(/^bool$/, () => new BoolType()),
    new BuiltinTypeDetector(/^string$/, () => new StringType()),
    new BuiltinTypeDetector(
        /^address( )*(payable)?$/,
        (matches) => new AddressType(matches[2] !== "")
    ),
    new BuiltinTypeDetector(/^bytes([0-9]?[0-9]?)$/, (matches) => {
        if (matches[1] === "") {
            return new BytesType();
        }

        const width = parseInt(matches[1]);

        if (width < 1 || width > 32) {
            return undefined;
        }

        return new FixedBytesType(width);
    }),
    new BuiltinTypeDetector(/^byte$/, () => new FixedBytesType(1)),
    new BuiltinTypeDetector(/^(u)?int([0-9]?[0-9]?[0-9]?)$/, (matches) => {
        const isSigned = matches[1] !== "u";

        if (matches[2] === "") {
            return new IntType(256, isSigned);
        }

        const width = parseInt(matches[2]);

        if (width % 8 !== 0 || width < 8 || width > 256) {
            return undefined;
        }

        return new IntType(width, isSigned);
    })
];

function tcIdBuiltinType(expr: SId): TypeNameType | undefined {
    for (const detector of BuiltinTypeDetectors) {
        const type = detector.detect(expr.name);

        if (type) {
            return new TypeNameType(type);
        }
    }

    return undefined;
}

function getTypeForCompilerVersion(
    typing: TypeNode | [TypeNode, string],
    compilerVersion: string
): TypeNode | undefined {
    if (typing instanceof TypeNode) {
        return typing;
    }

    const [type, version] = typing;

    return satisfies(compilerVersion, version) ? type : undefined;
}

function tcIdBuiltinSymbol(
    expr: SNode,
    name: string,
    typeEnv: TypeEnv,
    isAddressMember = false
): TypeNode | undefined {
    const mapping = isAddressMember ? BuiltinAddressMembers : BuiltinSymbols;
    const typing = mapping.get(name);

    /**
     * There is no typing for the builtin name.
     *
     * Leave handling to callers by returning `undefined`.
     */
    if (typing === undefined) {
        return undefined;
    }

    const type = getTypeForCompilerVersion(typing, typeEnv.compilerVersion);

    /**
     * There is a typing, but it is not covered by the target compiler version.
     *
     * Throw an error to inform user.
     */
    if (type === undefined) {
        throw new SInaccessibleForVersion(expr, name, typeEnv.compilerVersion);
    }

    return type;
}

/**
 * Given the type of some state variable `type`, a 'data-structure path' `path` find the path of the
 * element of the data structre pointed to by the data-structure path.
 */
function locateElementType(type: TypeName, path: DatastructurePath): TypeNode {
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

    return specializeType(typeNameToTypeNode(type), DataLocation.Storage);
}

/**
 * Given the type of some state variable `type`, a 'data-structure path' `path`, and an index `idx` in that path that
 * corresponds to some index variable, find the type of that index variable.
 */
function locateKeyType(type: TypeName, idx: number, path: Array<SId | string>): TypeNode {
    assert(idx < path.length, ``);

    const idxCompT = locateElementType(type, path.slice(0, idx));

    if (!(idxCompT instanceof PointerType)) {
        throw new Error(
            `Can't compute key type for field ${idx} in path ${pp(
                path
            )}: arrive at non-indexable type ${idxCompT.pp()}`
        );
    }

    if (idxCompT.to instanceof ArrayType) {
        return new IntType(256, false);
    }

    if (idxCompT.to instanceof MappingType) {
        return idxCompT.to.keyType;
    }

    throw new Error(
        `Can't compute key type for field ${idx} in path ${pp(
            path
        )}: arrive at non-indexable type ${idxCompT.pp()}`
    );
}

function tcIdVariable(expr: SId, ctx: STypingCtx, typeEnv: TypeEnv): TypeNode | undefined {
    const def = lookupVarDef(expr.name, ctx, typeEnv.compilerVersion);

    if (def === undefined) {
        return undefined;
    }

    expr.defSite = def;

    if (def instanceof VariableDeclaration) {
        if (def.vType === undefined) {
            throw new SMissingSolidityType(expr);
        }

        return astVarToTypeNode(def);
    }

    if (def instanceof SForAll) {
        return def.iteratorType;
    }

    const [defNode, bindingIdx] = def;

    if (defNode instanceof SLet) {
        const rhsT = tc(defNode.rhs, ctx, typeEnv);

        if (defNode.lhs.length > 1) {
            if (!(rhsT instanceof TupleType && rhsT.elements.length === defNode.lhs.length)) {
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

export function tcIdImportUnitRef(
    expr: SId,
    ctx: STypingCtx,
    typeEnv: TypeEnv
): ImportRefType | undefined {
    const scope = ctx[0];
    assert(scope instanceof ASTNode, `Expected root scope to be an ASTNode, not ${scope}`);
    const res = resolveAnyOfType(expr.name, scope, typeEnv.compilerVersion, ImportDirective);

    return res.length > 0 ? new ImportRefType(single(res)) : undefined;
}

export function tcId(expr: SId, ctx: STypingCtx, typeEnv: TypeEnv): TypeNode {
    if (expr.name === "this") {
        const contract = getScopeOfType(ContractDefinition, ctx);
        // this is not defined outside of the contract scope (i.e. in free functions)
        if (contract === undefined) {
            throw new SUnknownId(expr);
        }
        expr.defSite = "this";

        return mkUserDefinedType(contract);
    }

    // First try to TC the id as a builtin type
    let retT: TypeNode | undefined = tcIdBuiltinType(expr);

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
    const funDefs = lookupFun(expr.name, ctx, typeEnv.compilerVersion);

    if (funDefs.length > 0) {
        expr.defSite = "function_name";

        return new FunctionSetType(funDefs);
    }

    // Next try to TC it as a type name
    const userDef = lookupTypeDef(expr.name, ctx, typeEnv.compilerVersion);

    if (userDef !== undefined) {
        expr.defSite = "type_name";

        return new TypeNameType(mkUserDefinedType(userDef));
    }

    // Next check if this is a builtin symbol
    retT = tcIdBuiltinSymbol(expr, expr.name, typeEnv);

    if (retT !== undefined) {
        return retT;
    }

    // See if this is a user function
    const contractScope = getScopeOfType(ContractDefinition, ctx);
    if (contractScope !== undefined) {
        const userFun = typeEnv.getUserFunction(contractScope, expr.name);

        if (userFun !== undefined) {
            expr.defSite = userFun;
            return new FunctionType(
                undefined,
                userFun.parameters.map(([, type]) => type),
                [userFun.returnType],
                FunctionVisibility.Internal,
                FunctionStateMutability.View
            );
        }
    }

    // Next check if this is a builtin symbol
    retT = tcIdImportUnitRef(expr, ctx, typeEnv);

    if (retT !== undefined) {
        expr.defSite = (retT as ImportRefType).impStatement;
        return retT;
    }

    // If all fails, throw unknown id
    throw new SUnknownId(expr);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function tcResult(expr: SResult, ctx: STypingCtx): TypeNode {
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
        const retT = scope.vReturnParameters.vParameters[0];
        return astVarToTypeNode(retT);
    }

    return new TupleType(
        scope.vReturnParameters.vParameters.map((param) => astVarToTypeNode(param))
    );
}

export function tcUnary(expr: SUnaryOperation, ctx: STypingCtx, typeEnv: TypeEnv): TypeNode {
    if (expr.op === "!") {
        const innerT = tc(expr.subexp, ctx, typeEnv);
        if (!(innerT instanceof BoolType)) {
            throw new SWrongType(
                `Operation '!' expectes bool not ${innerT.pp()} in ${expr.pp()}`,
                expr.subexp,
                innerT
            );
        }

        return innerT;
    }

    if (expr.op === "-") {
        const innerT = tc(expr.subexp, ctx, typeEnv);
        if (!(innerT instanceof IntLiteralType || innerT instanceof IntType)) {
            throw new SWrongType(
                `Operation '-' expectes int or int literal, not ${innerT.pp()} in ${expr.pp()}`,
                expr.subexp,
                innerT
            );
        }

        return innerT;
    }

    assert(expr.op === "old", `Internal error: NYI unary op ${expr.op}`);
    return tc(expr.subexp, ctx, typeEnv);
}

/**
 * Return true IFF the expression `expr` of type `type` can be implicitly casted to the type `to`.
 */
export function isImplicitlyCastable(type: TypeNode, to: TypeNode): boolean {
    // The two types are equal - no cast neccessary
    if (eq(type, to)) {
        return true;
    }

    // int literal types can be casted to int types.
    // @todo once we get a constant expression evaluator add an optional `expr`
    // argument and check if it fits in `to`
    if (type instanceof IntLiteralType && to instanceof IntType) {
        return true;
    }

    // string literals can be implicitly cast to bytes/strings
    if (
        type instanceof StringLiteralType &&
        to instanceof PointerType &&
        (to.to instanceof BytesType || to.to instanceof StringType)
    ) {
        return true;
    }

    // ints can be implicitly cast to wider ints with the same sign
    if (type instanceof IntType && to instanceof IntType) {
        return type.signed === to.signed && type.nBits <= to.nBits;
    }

    // address (including payable) can be cast to non-payable address
    if (type instanceof AddressType && to instanceof AddressType) {
        return !to.payable;
    }

    // Allow implicit casts of the same type between calldata, storage and memory
    if (type instanceof PointerType && to instanceof PointerType && eq(type.to, to.to)) {
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
    typeA: TypeNode,
    exprB: SNode,
    typeB: TypeNode,
    commonParent: SNode
): TypeNode {
    if (isImplicitlyCastable(typeA, typeB)) {
        return typeB;
    }

    if (isImplicitlyCastable(typeB, typeA)) {
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
export function tcBinary(expr: SBinaryOperation, ctx: STypingCtx, typeEnv: TypeEnv): TypeNode {
    const lhsT = tc(expr.left, ctx, typeEnv);
    const rhsT = tc(expr.right, ctx, typeEnv);

    // Arithmetic binary expressions require the two types to be integer and implicitly castable to each other.
    if (expr.op === "**") {
        if (
            !(rhsT instanceof IntType || rhsT instanceof IntLiteralType) ||
            (rhsT instanceof IntType && rhsT.signed) ||
            (expr.right instanceof SNumber && expr.right.num.lt(0))
        ) {
            throw new SWrongType(
                `Type of ${expr.right.pp()} (${rhsT.pp()}) incompatible with ${expr.op} operator.`,
                expr.right,
                rhsT
            );
        }

        if (!(lhsT instanceof IntType || lhsT instanceof IntLiteralType)) {
            throw new SWrongType(
                `Type of ${expr.left.pp()} (${lhsT.pp()}) incompatible with ${expr.op} operator.`,
                expr.left,
                lhsT
            );
        }

        return lhsT instanceof IntLiteralType ? rhsT : lhsT;
    }

    if (["*", "%", "/", "+", "-"].includes(expr.op)) {
        if (!(lhsT instanceof IntType || lhsT instanceof IntLiteralType)) {
            throw new SWrongType(
                `Type of ${expr.left.pp()} (${lhsT.pp()}) incompatible with ${expr.op} operator.`,
                expr.left,
                lhsT
            );
        }

        if (!(rhsT instanceof IntType || rhsT instanceof IntLiteralType)) {
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
                lhsT instanceof IntType ||
                lhsT instanceof IntLiteralType ||
                lhsT instanceof FixedBytesType
            )
        ) {
            throw new SWrongType(
                `Type of ${expr.right.pp()} (${lhsT.pp()}) incompatible with ${expr.op} operator.`,
                expr.right,
                lhsT
            );
        }

        if (!(rhsT instanceof IntType || rhsT instanceof IntLiteralType)) {
            throw new SWrongType(
                `Type of ${expr.right.pp()} (${rhsT.pp()}) incompatible with ${expr.op} operator.`,
                expr.right,
                rhsT
            );
        }

        return lhsT instanceof IntLiteralType ? rhsT : lhsT;
    }

    // We restrict comparison operators to just ints/int literals
    if (["<", ">", "<=", ">="].includes(expr.op)) {
        if (
            !(
                lhsT instanceof IntType ||
                lhsT instanceof IntLiteralType ||
                lhsT instanceof FixedBytesType ||
                lhsT instanceof AddressType
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
                rhsT instanceof IntType ||
                rhsT instanceof IntLiteralType ||
                rhsT instanceof FixedBytesType ||
                rhsT instanceof AddressType
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
        return new BoolType();
    }

    if (["==", "!="].includes(expr.op)) {
        // Equality operators allow for the same or implicitly castable types.
        const commonType = unifyTypes(expr.left, lhsT, expr.right, rhsT, expr);

        if (commonType instanceof PointerType) {
            throw new SWrongType(
                `Operator ${
                    expr.op
                } doesn't apply to expression ${expr.left.pp()} of non-value type ${lhsT.pp()}`,
                expr.left,
                lhsT
            );
        }
        return new BoolType();
    }

    if (["|", "&", "^"].includes(expr.op)) {
        // Bitwise binary ops allow ints that can be implicitly converted to each other
        if (
            (lhsT instanceof IntType ||
                lhsT instanceof IntLiteralType ||
                lhsT instanceof FixedBytesType) &&
            (rhsT instanceof IntType ||
                rhsT instanceof IntLiteralType ||
                rhsT instanceof FixedBytesType)
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
        if (!(lhsT instanceof BoolType && rhsT instanceof BoolType)) {
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

        return new BoolType();
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
export function tcConditional(expr: SConditional, ctx: STypingCtx, typeEnv: TypeEnv): TypeNode {
    const condT = tc(expr.condition, ctx, typeEnv);
    const trueT = tc(expr.trueExp, ctx, typeEnv);
    const falseT = tc(expr.falseExp, ctx, typeEnv);

    if (!(condT instanceof BoolType)) {
        throw new SWrongType(
            `Conditional expects boolean for ${expr.condition.pp()} not ${condT.pp()}`,
            expr.condition,
            condT
        );
    }

    return unifyTypes(expr.trueExp, trueT, expr.falseExp, falseT, expr);
}

export function tcIndexAccess(expr: SIndexAccess, ctx: STypingCtx, typeEnv: TypeEnv): TypeNode {
    const baseT = tc(expr.base, ctx, typeEnv);
    const indexT = tc(expr.index, ctx, typeEnv);

    if (baseT instanceof FixedBytesType) {
        if (!isInty(indexT)) {
            throw new SWrongType(
                `Cannot index into ${expr.base.pp()} with ${expr.index.pp()} of type ${indexT.pp()}`,
                expr.index,
                indexT
            );
        }
        return new IntType(8, false);
    }

    if (baseT instanceof PointerType) {
        const toT = baseT.to;

        if (toT instanceof BytesType) {
            if (!isInty(indexT)) {
                throw new SWrongType(
                    `Cannot index into ${expr.base.pp()} with ${expr.index.pp()} of type ${indexT.pp()}`,
                    expr.index,
                    indexT
                );
            }
            return new FixedBytesType(1);
        }

        if (toT instanceof ArrayType) {
            if (!isInty(indexT)) {
                throw new SWrongType(
                    `Cannot index into ${expr.base.pp()} with ${expr.index.pp()} of type ${indexT.pp()}`,
                    expr.index,
                    indexT
                );
            }
            return toT.elementT;
        }

        if (toT instanceof MappingType) {
            if (!isImplicitlyCastable(indexT, toT.keyType)) {
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

export function tcMemberAccess(expr: SMemberAccess, ctx: STypingCtx, typeEnv: TypeEnv): TypeNode {
    const baseT = tc(expr.base, ctx, typeEnv);

    if (baseT instanceof BuiltinStructType) {
        const typing = baseT.members.get(expr.member);

        if (typing === undefined) {
            throw new SNoField(
                `Builtin struct "${expr.base.pp()}" does not have a member "${expr.member}"`,
                expr,
                expr.member
            );
        }

        const type = getTypeForCompilerVersion(typing, typeEnv.compilerVersion);

        if (type === undefined) {
            throw new SInaccessibleForVersion(expr, expr.member, typeEnv.compilerVersion);
        }

        return type;
    }

    if (baseT instanceof PointerType) {
        const baseLoc = baseT.location;
        const baseToT = baseT.to;

        if (baseToT instanceof ArrayType && expr.member === "length") {
            return new IntType(256, false);
        }

        if (baseToT instanceof UserDefinedType) {
            const rawDef = baseToT.definition;

            if (rawDef instanceof StructDefinition) {
                for (const rawDecl of rawDef.vMembers) {
                    if (expr.member === rawDecl.name) {
                        // rawDecl.vType is defined, as you can't put a `var x;` in a struct definition.
                        expr.defSite = rawDecl;
                        return astVarToTypeNode(rawDecl, baseLoc);
                    }
                }

                throw new SNoField(
                    `Struct ${baseToT.name} doesn't have a field ${expr.member}`,
                    expr,
                    expr.member
                );
            }
        }
    }

    if (baseT instanceof UserDefinedType && baseT.definition instanceof ContractDefinition) {
        const rawDef = baseT.definition;
        const funDefs = resolveByName(rawDef, FunctionDefinition, expr.member, false);

        if (funDefs.length > 0) {
            return new FunctionSetType(funDefs);
        }

        for (const varDecl of rawDef.vStateVariables) {
            if (
                expr.member === varDecl.name &&
                varDecl.visibility === StateVariableVisibility.Public
            ) {
                expr.defSite = varDecl;
                return new FunctionSetType([varDecl]);
            }
        }

        const type = tcIdBuiltinSymbol(expr, expr.member, typeEnv, true);

        if (type) {
            return type;
        }
    }

    if (baseT instanceof AddressType) {
        const type = tcIdBuiltinSymbol(expr, expr.member, typeEnv, true);

        if (type) {
            return type;
        }
    }

    if (
        baseT instanceof TypeNameType &&
        baseT.type instanceof UserDefinedType &&
        baseT.type.definition instanceof ContractDefinition
    ) {
        // First check if this is a type name
        const type = lookupTypeDef(expr.member, [baseT.type.definition], typeEnv.compilerVersion);

        if (type) {
            expr.defSite = type;
            return new TypeNameType(mkUserDefinedType(type));
        }

        // Next check if this is a Library.FunName
        const funDefs = resolveByName(
            baseT.type.definition,
            FunctionDefinition,
            expr.member,
            false
        );

        if (funDefs.length > 0) {
            return new FunctionSetType(funDefs);
        }
    }

    if (
        baseT instanceof TypeNameType &&
        baseT.type instanceof UserDefinedType &&
        baseT.type.definition instanceof EnumDefinition
    ) {
        const rawDef = baseT.type.definition;

        for (const enumVal of rawDef.vMembers) {
            if (enumVal.name === expr.member) {
                return baseT.type;
            }
        }
    }

    if (
        baseT instanceof FunctionSetType &&
        expr.member === "selector" &&
        baseT.definitions.length === 1
    ) {
        return new FixedBytesType(4);
    }

    if (baseT instanceof ImportRefType) {
        const sourceUnit = baseT.impStatement.vSourceUnit;
        try {
            const tmpId = new SId(expr.member, expr.src);
            const res = tc(tmpId, [sourceUnit], typeEnv);
            if (
                tmpId.defSite instanceof VariableDeclaration ||
                tmpId.defSite instanceof FunctionDefinition ||
                tmpId.defSite instanceof StructDefinition ||
                tmpId.defSite instanceof EnumDefinition ||
                tmpId.defSite instanceof ContractDefinition ||
                tmpId.defSite instanceof ImportDirective
            ) {
                expr.defSite = tmpId.defSite;
            }
            return res;
        } catch (e) {
            if (e instanceof SUnknownId) {
                throw new SNoField(
                    `Contract ${sourceUnit.sourceEntryKey} doesn't export symbol ${expr.member}`,
                    expr.base,
                    expr.member
                );
            }
        }
    }

    // Finally check if there is a `using for` declaration that binds a library to this type.
    const funs: Set<FunctionDefinition> = new Set();
    const [generalBaseT] = generalizeType(baseT);

    const contract = getScopeOfType(ContractDefinition, ctx);

    if (contract !== undefined) {
        for (const base of contract.vLinearizedBaseContracts) {
            for (const usingFor of base.vUsingForDirectives) {
                const libraryApplies =
                    usingFor.vTypeName === undefined
                        ? true
                        : eq(typeNameToTypeNode(usingFor.vTypeName), generalBaseT);

                if (libraryApplies) {
                    const library = usingFor.vLibraryName
                        .vReferencedDeclaration as ContractDefinition;
                    library.vFunctions
                        .filter((fun) => fun.name === expr.member)
                        .forEach((funDef) => funs.add(funDef));
                }
            }
        }

        if (funs.size > 0) {
            return new FunctionSetType([...funs], expr.base);
        }
    }

    throw new SNoField(
        `Expression ${expr.base.pp()} of type ${baseT.pp()} doesn't have a field ${expr.member}`,
        expr.base,
        expr.member
    );
}

export function tcLet(expr: SLet, ctx: STypingCtx, typeEnv: TypeEnv): TypeNode {
    // Make sure rhs tc's
    const rhsT = tc(expr.rhs, ctx, typeEnv);
    if (rhsT instanceof TupleType) {
        if (expr.lhs.length !== rhsT.elements.length) {
            throw new SExprCountMismatch(
                `Wrong number of let bindings: expected ${rhsT.elements.length} got ${expr.lhs.length}`,
                expr
            );
        }
        for (let i = 0; i < rhsT.elements.length; i++) {
            const elT = rhsT.elements[i];
            if (elT instanceof IntLiteralType) {
                const id = expr.lhs[i];
                throw new SGenericTypeError(
                    `Type of let-var ${id.name} is not uniquely defined from the right hand side. Please add a type cast on the right-hand side to set it`,
                    id
                );
            }
        }
    } else if (expr.lhs.length !== 1) {
        throw new SExprCountMismatch(
            `Wrong number of let bindings: expected 1 got ${expr.lhs.length}`,
            expr
        );
    } else if (rhsT instanceof IntLiteralType) {
        const id = single(expr.lhs);
        throw new SGenericTypeError(
            `Type of let-var ${
                id.name
            } is not uniquely defined from the right hand side. Please add a type cast on the right-hand side to set it (e.g. uint(${expr.rhs.pp()}))`,
            id
        );
    }

    const res = tc(expr.in, ctx.concat(expr), typeEnv);

    if (res instanceof IntLiteralType) {
        throw new SGenericTypeError(
            `Type of let expression is not uniquely defined from its body. Please add a type cast around the body to define it. (e.g. uint(${expr.in.pp()}))`,
            expr
        );
    }

    return res;
}

function getFunDefType(fun: FunctionDefinition): FunctionType {
    return new FunctionType(
        undefined,
        fun.vParameters.vParameters.map((param) => astVarToTypeNode(param)),
        fun.vReturnParameters.vParameters.map((param) => astVarToTypeNode(param)),
        fun.visibility,
        fun.stateMutability
    );
}

function matchArguments(
    arg: SNode[],
    argTs: TypeNode[],
    callable: FunctionDefinition | FunctionType
) {
    const funT = callable instanceof FunctionDefinition ? getFunDefType(callable) : callable;

    if (argTs.length !== funT.parameters.length) {
        return false;
    }

    for (let i = 0; i < funT.parameters.length; i++) {
        const formalT = funT.parameters[i];

        if (!isImplicitlyCastable(argTs[i], formalT)) {
            return false;
        }
    }

    return true;
}

/**
 * We check the following in `forall (uint t in [a ... b]) e(t)`:
 *   - `a` and `b` should be numeric and be castable to the type of `t`
 *   - type of `e(t)` is boolean
 *   (the requirement that the iterator variable `t` should have a numeric type is maintained by the grammar at the moment).
 */
export function tcForAll(expr: SForAll, ctx: STypingCtx, typeEnv: TypeEnv): TypeNode {
    // Call tc on iterator variable to make sure its defSite is set
    const varT = tc(expr.iteratorVariable, ctx.concat(expr), typeEnv);

    // Helper function that checks that start and end are integer types, and the iter var is also
    // an integer types. Used for the cases when expr.container is an array/fixed bytes, or when
    // explicit start/end are provided.
    const checkIntIterVar = (): void => {
        const startT = expr.start ? tc(expr.start, ctx, typeEnv) : new IntLiteralType();

        if (!(startT instanceof IntType || startT instanceof IntLiteralType)) {
            throw new SWrongType(
                `The expected type for start of the range is numeric and not ${startT.pp()}.`,
                expr.start ? expr.start : expr,
                startT
            );
        }

        const endT = expr.end ? tc(expr.end, ctx, typeEnv) : new IntType(256, false);
        if (!(endT instanceof IntType || endT instanceof IntLiteralType)) {
            throw new SWrongType(
                `The expected type for end of the range is numeric and not ${endT.pp()}.`,
                expr.end ? expr.end : expr,
                endT
            );
        }

        if (!isImplicitlyCastable(startT, expr.iteratorType)) {
            throw new SWrongType(
                `The type for ${expr.iteratorVariable.pp()} is not compatible with the start range type ${startT.pp()}.`,
                expr.iteratorVariable,
                expr.iteratorType
            );
        }

        if (!isImplicitlyCastable(endT, expr.iteratorType)) {
            throw new SWrongType(
                `The type for ${expr.iteratorVariable.pp()} is not compatible with the end range type ${endT.pp()}.`,
                expr.iteratorVariable,
                expr.iteratorType
            );
        }
    };

    // A more user-friendly error for the case when a non-array was passed
    if (expr.container !== undefined) {
        const containerT = tc(expr.container, ctx, typeEnv);

        if (
            (containerT instanceof PointerType && containerT.to instanceof ArrayType) ||
            containerT instanceof FixedBytesType
        ) {
            checkIntIterVar();
        } else if (containerT instanceof PointerType && containerT.to instanceof MappingType) {
            const keyT = containerT.to.keyType;
            if (!isImplicitlyCastable(keyT, varT)) {
                throw new SWrongType(
                    `The type for the iterator variable ${
                        expr.iteratorVariable.name
                    } ${varT.pp()} is not castable to the mapping key type ${keyT.pp()}.`,
                    expr.iteratorVariable,
                    varT
                );
            }
        } else {
            throw new SWrongType(
                `Provided iterable ${expr.container.pp()} is not an array, fixed bytes or a mapping - instead got ${containerT.pp()}.`,
                expr.container,
                containerT
            );
        }
    } else {
        checkIntIterVar();
    }

    const exprT = tc(expr.expression, ctx.concat(expr), typeEnv);
    if (!(exprT instanceof BoolType)) {
        throw new SWrongType(
            `The expected type for ${expr.expression.pp()} is boolean and not ${exprT}.`,
            expr.expression,
            exprT
        );
    }

    return exprT;
}

export function tcFunctionCall(expr: SFunctionCall, ctx: STypingCtx, typeEnv: TypeEnv): TypeNode {
    const callee = expr.callee;

    if (callee instanceof SId && callee.name === BuiltinFunctions.unchecked_sum) {
        callee.defSite = "builtin_fun";

        if (expr.args.length !== 1) {
            throw new SExprCountMismatch(
                `Calls to sum expect a single argument, not ${expr.args.length} in ${expr.pp()}`,
                expr
            );
        }

        const argT = tc(expr.args[0], ctx, typeEnv);

        if (!(argT instanceof PointerType)) {
            throw new SWrongType(
                `sum expects a numeric array or map to numbers, not ${argT.pp()} in ${expr.pp()}`,
                expr,
                argT
            );
        }

        if (argT.to instanceof MappingType && argT.to.valueType instanceof IntType) {
            return new IntType(256, argT.to.valueType.signed);
        }

        if (argT.to instanceof ArrayType && argT.to.elementT instanceof IntType) {
            return new IntType(256, argT.to.elementT.signed);
        }

        throw new SWrongType(
            `sum expects a numeric array or map to numbers, not ${argT.pp()} in ${expr.pp()}`,
            expr,
            argT
        );
    }

    /**
     * There are 4 semantic cases for a function call:
     *  - callee is a type (type cast). calleeT is either a SBuiltinTypeNameType or SUserDefinedTypeNameType
     *  - callee is a function identifier
     *  - callee is a user-defined function identifier
     *  - callee is a spec builtin/keyword (e.g. sum()) - to be implemented
     */
    const calleeT = tc(callee, ctx, typeEnv);

    // Type-cast to a built-in type
    if (calleeT instanceof TypeNameType) {
        expr.args.map((arg) => tc(arg, ctx, typeEnv));

        if (expr.args.length !== 1) {
            throw new SExprCountMismatch(
                `Type casts expect exactly 1 argument, not ${expr.pp()}.`,
                expr
            );
        }

        return specializeType(calleeT.type, DataLocation.Memory);
    }

    // Type-cast to a user-defined type or a struct constructor
    if (calleeT instanceof UserDefinedType) {
        const argTs = expr.args.map((arg) => tc(arg, ctx, typeEnv));

        if (calleeT.definition instanceof StructDefinition) {
            // Struct constructor case - always lives in memory
            return new PointerType(mkUserDefinedType(calleeT.definition), DataLocation.Memory);
        }

        if (
            calleeT.definition instanceof ContractDefinition ||
            calleeT.definition instanceof EnumDefinition
        ) {
            // Type-casting case - note that contract references and enums are not pointers
            if (argTs.length !== 1) {
                throw new SExprCountMismatch(
                    `Type casts expect exactly 1 argument, not ${expr.pp()}.`,
                    expr
                );
            }

            return calleeT;
        }

        throw new Error(`Unknown cast to user defined type ${expr.pp()}`);
    }

    // Function or public getter
    if (calleeT instanceof FunctionSetType) {
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
                                ? def.canonicalSignature(typeEnv.encoderVersion)
                                : def.getterCanonicalSignature(typeEnv.encoderVersion)
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

        if (callee instanceof SId || callee instanceof SMemberAccess) {
            callee.defSite = def;
        }

        if (def instanceof FunctionDefinition) {
            // param.vType is defined, as you can't put a `var x,` in a function definition.
            const retTs = def.vReturnParameters.vParameters.map((param) => astVarToTypeNode(param));

            if (retTs.length === 1) {
                return retTs[0];
            }

            if (retTs.length > 1) {
                return new TupleType(retTs);
            }

            throw new SFunNoReturn(`Function ${def.name} doesn't return a type`, expr);
        } else {
            if (def.vType instanceof UserDefinedTypeName) {
                throw new Error(`NYI public getters for ${def.vType.print()}`);
            }

            // def.vType is defined, as you can't put a `var x,` in a contract state var definition.
            return astVarToTypeNode(def);
        }
    }

    // Builtin function
    if (calleeT instanceof FunctionType) {
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
            return new TupleType(retTs);
        }

        throw new SFunNoReturn(`Function type "${calleeT.pp()}" doesn't return a type`, expr);
    }

    throw new SWrongType(`Cannot call ${callee.pp()} of type ${calleeT.pp()}`, callee, calleeT);
}
