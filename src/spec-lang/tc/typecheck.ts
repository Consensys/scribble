import {
    ASTNode,
    ASTNodeConstructor,
    AddressType,
    AnyResolvable,
    ArrayType,
    ArrayTypeName,
    BoolType,
    BuiltinFunctionType,
    BuiltinStructType,
    BytesType,
    ContractDefinition,
    ContractKind,
    DataLocation,
    EnumDefinition,
    FixedBytesType,
    FunctionDefinition,
    FunctionStateMutability,
    FunctionType,
    FunctionVisibility,
    IdentifierPath,
    ImportDirective,
    ImportRefType,
    InferType,
    IntLiteralType,
    IntType,
    Mapping,
    MappingType,
    PPAble,
    PackedArrayType,
    PointerType,
    SourceUnit,
    StateVariableVisibility,
    Statement,
    StatementWithChildren,
    StringLiteralType,
    StructDefinition,
    TRest,
    TupleType,
    TypeName,
    TypeNameType,
    TypeNode,
    UserDefinedType,
    UserDefinedTypeName,
    UserDefinedValueTypeDefinition,
    UsingForDirective,
    VariableDeclaration,
    VariableDeclarationStatement,
    addressBuiltins,
    applySubstitution,
    assert,
    castable,
    eq,
    evalBinaryImpl,
    generalizeType,
    globalBuiltins,
    pp,
    resolveAny,
    resolveByName,
    specializeType,
    typeContract,
    typeInt,
    typeInterface
} from "solc-typed-ast";
import { AnnotationMap, AnnotationMetaData, AnnotationTarget } from "../../instrumenter";
import { Logger } from "../../logger";
import { last, single, topoSort } from "../../util";
import {
    AnnotationType,
    DatastructurePath,
    NodeLocation,
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
    SLetAnnotation,
    SMemberAccess,
    SNode,
    SNumber,
    SProperty,
    SResult,
    SStateVarProp,
    SStringLiteral,
    STryAnnotation,
    SUnaryOperation,
    SUserConstantDefinition,
    SUserFunctionDefinition,
    ScribbleBuiltinFunctions,
    VarDefSite
} from "../ast";
import { FunctionSetType } from "./internal_types";
import { TypeEnv } from "./typeenv";

export class StateVarScope implements PPAble {
    constructor(
        public readonly target: VariableDeclaration,
        public readonly annotation: SStateVarProp
    ) {}

    pp(): string {
        return `StateVarScope(${pp(this.target)} => ${pp(this.annotation)})`;
    }
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

export interface STypingCtx {
    type: AnnotationType;
    annotation: SNode;
    target: AnnotationTarget;
    scopes: SScope[];
    isOld: boolean;
    annotationMap: AnnotationMap;
}

function addScope(ctx: STypingCtx, scope: SScope): STypingCtx {
    return {
        type: ctx.type,
        target: ctx.target,
        scopes: [...ctx.scopes, scope],
        isOld: ctx.isOld,
        annotationMap: ctx.annotationMap,
        annotation: ctx.annotation
    };
}

function oldCtx(ctx: STypingCtx): STypingCtx {
    return {
        type: ctx.type,
        target: ctx.target,
        scopes: ctx.scopes,
        isOld: true,
        annotationMap: ctx.annotationMap,
        annotation: ctx.annotation
    };
}

function fromCtx(ctx: STypingCtx, other: Partial<STypingCtx>): STypingCtx {
    return { ...ctx, ...other };
}

export function ppTypingCtx(ctx: STypingCtx): string {
    return ctx.scopes
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
    if (ctx.scopes[0] instanceof constr) {
        return ctx.scopes[0];
    }

    return (ctx.scopes[0] as ASTNode).getClosestParentByType(constr);
}

export abstract class STypeError extends Error {
    abstract loc(): NodeLocation;
    public annotationMetaData!: AnnotationMetaData;
}

export class SGenericTypeError<T extends SNode> extends STypeError {
    public readonly node: T;

    constructor(msg: string, node: T) {
        super(msg);
        this.node = node;
    }

    loc(): NodeLocation {
        return this.node.src as NodeLocation;
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
        super(msg, call);
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
    readonly src: NodeLocation;

    constructor(
        msg: string,
        exprA: SNode,
        typeA: TypeNode,
        exprB: SNode,
        typeB: TypeNode,
        src: NodeLocation
    ) {
        super(msg);

        this.exprA = exprA;
        this.typeA = typeA;
        this.exprB = exprB;
        this.typeB = typeB;
        this.src = src;
    }

    loc(): NodeLocation {
        return this.src;
    }
}

export class SInvalidKeyword extends SGenericTypeError<SNode> {
    constructor(msg: string, node: SNode) {
        super(msg, node);
    }
}

export class SShadowingError extends SGenericTypeError<SNode> {
    public readonly original: SNode | ASTNode;

    constructor(msg: string, node: SNode, original: SNode | ASTNode) {
        super(msg, node);
        this.original = original;
    }
}

function resolveAnyOfType<T extends AnyResolvable>(
    name: string,
    scope: ASTNode,
    inference: InferType,
    t: ASTNodeConstructor<T>,
    inclusive: boolean
): T[] {
    return [...resolveAny(name, scope, inference, inclusive)].filter((x) => x instanceof t) as T[];
}

/**
 * Given a variable name and a stack of scopes find the definition of this variable.
 *
 * @param name variable name
 * @param ctx stack of scopes in which we are looking for `name`'s definition
 */
function lookupVarDef(name: string, ctx: STypingCtx, inference: InferType): VarDefSite | undefined {
    // Walk the scope stack down looking for the definition of v
    for (let i = ctx.scopes.length - 1; i >= 0; i--) {
        const scope = ctx.scopes[i];

        if (scope instanceof ASTNode) {
            // We want to exclude the current node is if:
            //  a) Its VariableDeclarationStatement and the annotation is not an IfSucceeds
            //     or
            //  b) Its VariableDeclarationStatement and the annotation is an IfSucceeds and its in the old ctx
            const exclude =
                scope instanceof VariableDeclarationStatement &&
                (ctx.type !== AnnotationType.IfSucceeds || ctx.isOld);

            const res = resolveAnyOfType(name, scope, inference, VariableDeclaration, !exclude);

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
 * Lookup any function definition(s) of name `name` in `STypeingCtx` `ctx`.
 */
function lookupFun(name: string, ctx: STypingCtx, inference: InferType): FunctionDefinition[] {
    const scope = ctx.scopes[0];

    assert(scope instanceof ASTNode, "Expected root scope to be an ASTNode, not {0}", scope);

    return resolveAnyOfType(name, scope, inference, FunctionDefinition, true);
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
    inference: InferType
): StructDefinition | EnumDefinition | ContractDefinition | undefined {
    const scope = ctx.scopes[0];

    assert(scope instanceof ASTNode, "Expected root scope to be an ASTNode, not {0}", scope);

    const res = [...resolveAny(name, scope, inference, true)].filter(
        (x) =>
            x instanceof StructDefinition ||
            x instanceof EnumDefinition ||
            x instanceof ContractDefinition ||
            x instanceof UserDefinedValueTypeDefinition
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
        const annotations = annotMap.get(target) as AnnotationMetaData[];

        for (const annotationMD of annotations) {
            const typingCtx: STypingCtx = {
                target: target,
                type: annotationMD.type,
                annotation: annotationMD.parsedAnnot,
                annotationMap: annotMap,
                scopes: [
                    target instanceof VariableDeclaration
                        ? (target.vScope as ContractDefinition)
                        : target
                ],
                isOld: false
            };

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
                `Unexpected if_updated target: {0}`,
                target
            );

            predCtx = addScope(ctx, new StateVarScope(target, annot));

            assert(target.vType !== undefined, `State var ${target.name} is missing a type.`);

            // Check to make sure the datastructure path matches the type of the
            // underlying target state var
            locateElementType(typeEnv.inference, target.vType, annot.datastructurePath);
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
    } else if (annot instanceof SUserConstantDefinition) {
        const constScope = target as ContractDefinition;
        const existing = typeEnv.userConstants.get(constScope, annot.name.name);

        if (existing) {
            throw new SDuplicateError(
                `User constant ${annot.name.name} already defined`,
                existing,
                annot
            );
        }
        ``;

        const actualType = tc(annot.value, ctx, typeEnv);

        if (!castable(actualType, annot.formalType, typeEnv.compilerVersion)) {
            throw new SWrongType(
                `User constant ${
                    annot.name.name
                } declares type ${annot.formalType.pp()} but value type is ${actualType.pp()}`,
                annot.value,
                actualType
            );
        }

        typeEnv.userConstants.define(constScope, annot);
    } else if (annot instanceof SUserFunctionDefinition) {
        const funScope = last(ctx.scopes);

        if (!(funScope instanceof ContractDefinition)) {
            throw new SGenericTypeError(
                `User functions can only be defined on contract annotations at the moment.`,
                annot
            );
        }

        const existing = typeEnv.userFunctions.get(funScope, annot.name.name);

        if (existing) {
            throw new SDuplicateError(
                `User function ${annot.name.name} already defined`,
                existing,
                annot
            );
        }

        for (const [argName, argType] of annot.parameters) {
            // The argument is a reference type without a data location
            if (
                argType instanceof ArrayType ||
                argType instanceof PackedArrayType ||
                (argType instanceof UserDefinedType &&
                    argType.definition instanceof StructDefinition)
            ) {
                throw new SGenericTypeError(
                    `Missing data location for argument ${argName.name} of function ${annot.name.name}`,
                    argName
                );
            }
        }

        const bodyType = tc(annot.body, addScope(ctx, annot), typeEnv);

        if (!castable(bodyType, annot.returnType, typeEnv.compilerVersion)) {
            throw new SWrongType(
                `User function ${
                    annot.name
                } declares return type ${annot.returnType.pp()} but returns ${bodyType.pp()}`,
                annot.body,
                bodyType
            );
        }

        typeEnv.userFunctions.define(funScope, annot);
    } else if (annot instanceof SLetAnnotation) {
        const shadowedDefs = resolveAny(annot.name.name, ctx.target, typeEnv.inference);

        if (shadowedDefs.size > 0) {
            throw new SShadowingError(
                `Let-binding of ${annot.name.name} shadows existing definition.`,
                annot,
                [...shadowedDefs][0]
            );
        }

        const idType = tc(annot.expression, ctx, typeEnv);

        typeEnv.define(annot.name, idType);
    } else if (annot instanceof STryAnnotation) {
        for (const expr of annot.exprs) {
            const exprType = tc(expr, ctx, typeEnv);

            if (!(exprType instanceof BoolType)) {
                throw new SWrongType(
                    `${
                        annot.type
                    } expects one or more expressions of type bool not ${exprType.pp()}`,
                    expr,
                    exprType
                );
            }
        }
    } else {
        throw new Error(`NYI type-checking of annotation ${annot.pp()}`);
    }
}

export function tc(expr: SNode | TypeNode, ctx: STypingCtx, typeEnv: TypeEnv): TypeNode {
    const cache = (expr: SNode, type: TypeNode): TypeNode => {
        Logger.debug(`tc: ${expr.pp()} :: ${type.pp()}`);

        typeEnv.define(expr, type);

        return type;
    };

    if (expr instanceof SNode && typeEnv.hasType(expr)) {
        return typeEnv.typeOf(expr);
    }

    if (expr instanceof SNumber) {
        return cache(expr, new IntLiteralType(expr.num));
    }

    if (expr instanceof SBooleanLiteral) {
        return cache(expr, new BoolType());
    }

    if (expr instanceof SStringLiteral) {
        return cache(expr, new StringLiteralType("string"));
    }

    if (expr instanceof SHexLiteral) {
        return cache(expr, new StringLiteralType("hexString"));
    }

    if (expr instanceof SAddressLiteral) {
        return cache(expr, new AddressType(true));
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

function tcIdBuiltinType(expr: SId): TypeNameType | undefined {
    const type = InferType.elementaryTypeNameStringToTypeNode(expr.name);

    if (type === undefined) {
        return undefined;
    }

    if (type instanceof FixedBytesType && (type.size < 1 || type.size > 32)) {
        return undefined;
    }

    if (type instanceof IntType && (type.nBits % 8 !== 0 || type.nBits < 8 || type.nBits > 256)) {
        return undefined;
    }

    return new TypeNameType(type);
}

function tcIdBuiltinSymbol(
    expr: SNode,
    name: string,
    typeEnv: TypeEnv,
    isAddressMember = false
): TypeNode | undefined {
    const mapping = isAddressMember ? addressBuiltins : globalBuiltins;

    return mapping.getFieldForVersion(name, typeEnv.compilerVersion);
}

/**
 * Given the type of some state variable `type`, a 'data-structure path' `path` find the path of the
 * element of the data structre pointed to by the data-structure path.
 */
function locateElementType(
    inference: InferType,
    type: TypeName,
    path: DatastructurePath
): TypeNode {
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
                `Expected a single field with name ${element} on struct ${structDef.name}`
            );

            assert(
                field.vType !== undefined,
                "Missing type on field {0} of struct {1}",
                field.name,
                structDef
            );

            type = field.vType;
        }
    }

    return inference.typeNameToSpecializedTypeNode(type, DataLocation.Storage);
}

/**
 * Given the type of some state variable `type`, a 'data-structure path' `path`, and an index `idx` in that path that
 * corresponds to some index variable, find the type of that index variable.
 */
function locateKeyType(
    inference: InferType,
    type: TypeName,
    idx: number,
    path: Array<SId | string>
): TypeNode {
    assert(idx < path.length, "Index {0} exceeds path length {1}", idx, path);

    const idxCompT = locateElementType(inference, type, path.slice(0, idx));

    if (idxCompT instanceof PointerType) {
        if (idxCompT.to instanceof ArrayType) {
            return new IntType(256, false);
        }

        if (idxCompT.to instanceof MappingType) {
            return idxCompT.to.keyType;
        }
    }

    assert(
        false,
        "Can't compute key type for field {0} in path {1}: arrive at non-indexable type {2}",
        idx,
        path,
        idxCompT
    );
}

function tcLetAnnotationId(expr: SId, ctx: STypingCtx, typeEnv: TypeEnv): TypeNode | undefined {
    let curNode = last(ctx.scopes);

    while (curNode instanceof Statement || curNode instanceof StatementWithChildren) {
        const annots = ctx.annotationMap.get(curNode);

        if (annots !== undefined) {
            for (const annot of annots) {
                // Stop if we've reached the current annotation
                // Note this depends on all annotations on a single statement being parsed
                // in the same order as they are written.
                if (curNode === annot.target && annot.parsedAnnot === ctx.annotation) {
                    break;
                }

                if (
                    annot.parsedAnnot instanceof SLetAnnotation &&
                    expr.name === annot.parsedAnnot.name.name
                ) {
                    // Note: This depends on `let x:=` always being type-checked before the uses of `x`.
                    expr.defSite = annot.parsedAnnot;
                    return typeEnv.typeOf(annot.parsedAnnot.expression);
                }
            }
        }

        const pt = curNode.parent;

        if (pt instanceof StatementWithChildren) {
            const idx = pt.children.indexOf(curNode);

            if (idx > 0) {
                curNode = pt.children[idx - 1];
            } else {
                curNode = pt;
            }
        } else if (pt instanceof Statement || pt instanceof StatementWithChildren) {
            curNode = pt;
        } else {
            break;
        }
    }

    return undefined;
}

function tcIdVariable(expr: SId, ctx: STypingCtx, typeEnv: TypeEnv): TypeNode | undefined {
    const def = lookupVarDef(expr.name, ctx, typeEnv.inference);

    if (def === undefined) {
        return undefined;
    }

    expr.defSite = def;

    if (def instanceof VariableDeclaration) {
        if (def.vType === undefined) {
            throw new SMissingSolidityType(expr);
        }

        return typeEnv.inference.variableDeclarationToTypeNode(def);
    }

    if (def instanceof SForAll) {
        return def.iteratorType;
    }

    // For now statement let bindings are handled in tcLetAnnotationId.
    if (def instanceof SLetAnnotation) {
        return undefined;
    }

    const [defNode, bindingIdx] = def;

    if (defNode instanceof SLet) {
        const rhsT = typeEnv.typeOf(defNode.rhs);

        if (defNode.lhs.length > 1) {
            if (!(rhsT instanceof TupleType && rhsT.elements.length === defNode.lhs.length)) {
                throw new SExprCountMismatch(
                    `Wrong number of values for let bindings in ${defNode.pp()}. Expected ${
                        defNode.lhs.length
                    } values, instead got ${rhsT.pp()}`,
                    defNode
                );
            }

            const elT = rhsT.elements[bindingIdx];

            return elT ? elT : undefined;
        }

        return rhsT;
    }

    if (defNode instanceof StateVarScope) {
        assert(
            defNode.target.vType !== undefined,
            "Expected target {0} for if_updated to have a vType.",
            defNode.target
        );

        return locateKeyType(
            typeEnv.inference,
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
    const scope = ctx.scopes[0];

    assert(scope instanceof ASTNode, "Expected root scope to be an ASTNode, not {0}", scope);

    const res = resolveAnyOfType(expr.name, scope, typeEnv.inference, ImportDirective, true);

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

    // Next try to TC the id as a let-annotation
    retT = tcLetAnnotationId(expr, ctx, typeEnv);

    if (retT !== undefined) {
        return retT;
    }

    // See if this is a user function
    const contractScope = getScopeOfType(ContractDefinition, ctx);

    if (contractScope !== undefined) {
        const constDef = typeEnv.userConstants.get(contractScope, expr.name);

        if (constDef) {
            expr.defSite = constDef;

            return constDef.formalType;
        }
    }

    // Next lets try to TC as a function name (note - can't be a public getter
    // as those only appear in MemberExpressions)
    const funDefs = lookupFun(expr.name, ctx, typeEnv.inference);

    if (funDefs.length > 0) {
        expr.defSite = "function_name";

        return new FunctionSetType(funDefs);
    }

    // Next try to TC it as a type name
    const typeDef = lookupTypeDef(expr.name, ctx, typeEnv.inference);

    if (typeDef !== undefined) {
        expr.defSite = "type_name";

        return new TypeNameType(mkUserDefinedType(typeDef));
    }

    // Next check if this is a builtin symbol
    retT = tcIdBuiltinSymbol(expr, expr.name, typeEnv);

    if (retT !== undefined) {
        return retT;
    }

    if (contractScope !== undefined) {
        const userFun = typeEnv.userFunctions.get(contractScope, expr.name);

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

    if (retT instanceof ImportRefType) {
        expr.defSite = retT.importStmt;

        return retT;
    }

    // If all fails, throw unknown id
    throw new SUnknownId(expr);
}

export function tcResult(expr: SResult, ctx: STypingCtx, typeEnv: TypeEnv): TypeNode {
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

    const rets = scope.vReturnParameters.vParameters.map((param) =>
        typeEnv.inference.variableDeclarationToTypeNode(param)
    );

    return rets.length === 1 ? rets[0] : new TupleType(rets);
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

        if (
            innerT instanceof IntType ||
            (innerT instanceof IntLiteralType && innerT.literal === undefined)
        ) {
            return innerT;
        }

        if (innerT instanceof IntLiteralType && innerT.literal !== undefined) {
            return new IntLiteralType(-innerT.literal);
        }

        throw new SWrongType(
            `Operation '-' expectes int or int literal, not ${innerT.pp()} in ${expr.pp()}`,
            expr.subexp,
            innerT
        );
    }

    assert(expr.op === "old", `Internal error: NYI unary op ${expr.op}`);

    return tc(expr.subexp, oldCtx(ctx), typeEnv);
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
    commonParent: SNode,
    compilerVersion: string
): TypeNode {
    if (castable(typeA, typeB, compilerVersion)) {
        return typeB;
    }

    if (castable(typeB, typeA, compilerVersion)) {
        return typeA;
    }

    // Bit of a hack, but if we are trying to unify 2 concrete int literal types,
    // just return the generic int literal type with no concrete literal.
    if (typeA instanceof IntLiteralType && typeB instanceof IntLiteralType) {
        return new IntLiteralType();
    }

    throw new IncompatibleTypes(
        `Types of ${exprA.pp()} (${typeA.pp()}) and ${exprB.pp()} (${typeB.pp()}) are incompatible`,
        exprA,
        typeA,
        exprB,
        typeB,
        commonParent.src as NodeLocation
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
            lhsT instanceof IntLiteralType &&
            lhsT.literal !== undefined &&
            rhsT instanceof IntLiteralType &&
            rhsT.literal !== undefined
        ) {
            const res = evalBinaryImpl(expr.op, lhsT.literal, rhsT.literal);

            return new IntLiteralType(res as bigint);
        }

        if (
            !(rhsT instanceof IntType || rhsT instanceof IntLiteralType) ||
            (rhsT instanceof IntType && rhsT.signed) ||
            (expr.right instanceof SNumber && expr.right.num < 0)
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
        if (
            lhsT instanceof IntLiteralType &&
            lhsT.literal !== undefined &&
            rhsT instanceof IntLiteralType &&
            rhsT.literal !== undefined
        ) {
            const res = evalBinaryImpl(expr.op, lhsT.literal, rhsT.literal);

            return new IntLiteralType(res as bigint);
        }

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

        return unifyTypes(expr.left, lhsT, expr.right, rhsT, expr, typeEnv.compilerVersion);
    }

    // Bit shifts require that the lhs is integer, int constant or fixed bytes and that the rhs is an int or int literal
    if (["<<", ">>"].includes(expr.op)) {
        if (
            lhsT instanceof IntLiteralType &&
            lhsT.literal !== undefined &&
            rhsT instanceof IntLiteralType &&
            rhsT.literal !== undefined
        ) {
            const res = evalBinaryImpl(expr.op, lhsT.literal, rhsT.literal);

            return new IntLiteralType(res as bigint);
        }

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

        // Make sure the two types unify. Ignore this if they are both int literals
        unifyTypes(expr.left, lhsT, expr.right, rhsT, expr, typeEnv.compilerVersion);

        return new BoolType();
    }

    if (["==", "!="].includes(expr.op)) {
        // Equality operators allow for the same or implicitly castable types.
        const commonType = unifyTypes(
            expr.left,
            lhsT,
            expr.right,
            rhsT,
            expr,
            typeEnv.compilerVersion
        );

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
            return unifyTypes(expr.left, lhsT, expr.right, rhsT, expr, typeEnv.compilerVersion);
        }

        throw new IncompatibleTypes(
            `Types ${lhsT.pp()} and ${rhsT.pp()} not compatible with binary operator ${
                expr.op
            } in ${expr.pp()}`,
            expr.left,
            lhsT,
            expr.right,
            rhsT,
            expr.src as NodeLocation
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
                expr.src as NodeLocation
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

    return unifyTypes(expr.trueExp, trueT, expr.falseExp, falseT, expr, typeEnv.compilerVersion);
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
            if (!castable(indexT, toT.keyType, typeEnv.compilerVersion)) {
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

function getFieldOfBuiltinStruct(
    struct: BuiltinStructType,
    expr: SMemberAccess,
    typeEnv: TypeEnv
): TypeNode {
    const type = struct.getFieldForVersion(expr.member, typeEnv.compilerVersion);

    if (type === undefined) {
        throw new SInaccessibleForVersion(expr, expr.member, typeEnv.compilerVersion);
    }

    return type;
}

export function tcMemberAccess(expr: SMemberAccess, ctx: STypingCtx, typeEnv: TypeEnv): TypeNode {
    const baseT = tc(expr.base, ctx, typeEnv);

    if (baseT instanceof BuiltinStructType) {
        return getFieldOfBuiltinStruct(baseT, expr, typeEnv);
    }

    if (baseT instanceof PointerType) {
        const baseToT = baseT.to;

        if (
            (baseToT instanceof ArrayType || baseToT instanceof BytesType) &&
            expr.member === "length"
        ) {
            return new IntType(256, false);
        }

        if (baseToT instanceof UserDefinedType) {
            const rawDef = baseToT.definition;

            if (rawDef instanceof StructDefinition) {
                for (const rawDecl of rawDef.vMembers) {
                    if (expr.member === rawDecl.name) {
                        // rawDecl.vType is defined, as you can't put a `var x;` in a struct definition.
                        expr.defSite = rawDecl;

                        const varT = typeEnv.inference.variableDeclarationToTypeNode(rawDecl);

                        if (baseT.location === DataLocation.Default) {
                            return varT;
                        }

                        return specializeType(generalizeType(varT)[0], baseT.location);
                    }
                }
            }
        }
    }

    if (baseT instanceof UserDefinedType && baseT.definition instanceof ContractDefinition) {
        const rawDef = baseT.definition;
        const funDefs = resolveByName(
            rawDef,
            FunctionDefinition,
            expr.member,
            typeEnv.inference,
            false
        );

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

    // Address type builtin members
    if (baseT instanceof AddressType) {
        const type = tcIdBuiltinSymbol(expr, expr.member, typeEnv, true);

        if (type) {
            return type;
        }
    }

    // User defined value types wrap() and unwrap()
    if (
        baseT instanceof TypeNameType &&
        baseT.type instanceof UserDefinedType &&
        baseT.type.definition instanceof UserDefinedValueTypeDefinition
    ) {
        const userDefValType = baseT.type.definition;
        const underlyingType = userDefValType.underlyingType;

        if (expr.member === "wrap") {
            return new FunctionType(
                "wrap",
                [typeEnv.inference.typeNameToTypeNode(underlyingType)],
                [baseT.type],
                FunctionVisibility.Default,
                FunctionStateMutability.Pure
            );
        }

        if (expr.member === "unwrap") {
            return new FunctionType(
                "unwrap",
                [baseT.type],
                [typeEnv.inference.typeNameToTypeNode(underlyingType)],
                FunctionVisibility.Default,
                FunctionStateMutability.Pure
            );
        }
    }

    if (
        baseT instanceof TypeNameType &&
        baseT.type instanceof UserDefinedType &&
        baseT.type.definition instanceof ContractDefinition
    ) {
        // First check if this is a type name
        const type = lookupTypeDef(
            expr.member,
            fromCtx(ctx, { scopes: [baseT.type.definition], isOld: false }),
            typeEnv.inference
        );

        if (type) {
            expr.defSite = type;
            return new TypeNameType(mkUserDefinedType(type));
        }

        // Next check if this is a Library.FunName
        const funDefs = resolveByName(
            baseT.type.definition,
            FunctionDefinition,
            expr.member,
            typeEnv.inference,
            false
        );

        if (funDefs.length > 0) {
            return new FunctionSetType(funDefs);
        }

        // Next check if this is a library constant
        const def = lookupVarDef(
            expr.member,
            fromCtx(ctx, { scopes: [baseT.type.definition], isOld: false }),
            typeEnv.inference
        );

        if (def !== undefined && def instanceof VariableDeclaration && def.constant) {
            return typeEnv.inference.variableDeclarationToTypeNode(def);
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
        const sourceUnit = baseT.importStmt.vSourceUnit;
        try {
            const tmpId = new SId(expr.member, expr.src);
            const res = tc(tmpId, fromCtx(ctx, { scopes: [sourceUnit], isOld: false }), typeEnv);
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
        const usingForInScope: UsingForDirective[] = [];

        for (const base of contract.vLinearizedBaseContracts) {
            usingForInScope.push(...base.vUsingForDirectives);
        }

        usingForInScope.push(...contract.vScope.vUsingForDirectives);

        for (const usingFor of usingForInScope) {
            const usingForApplies =
                usingFor.vTypeName === undefined ||
                eq(typeEnv.inference.typeNameToTypeNode(usingFor.vTypeName), generalBaseT);

            if (!usingForApplies) {
                continue;
            }

            if (usingFor.vLibraryName) {
                const library = usingFor.vLibraryName.vReferencedDeclaration as ContractDefinition;
                library.vFunctions
                    .filter((fun) => fun.name === expr.member)
                    .forEach((funDef) => funs.add(funDef));
            }

            if (usingFor.vFunctionList) {
                usingFor.vFunctionList
                    .filter(
                        (idPath): idPath is IdentifierPath =>
                            idPath instanceof IdentifierPath && idPath.name === expr.member
                    )
                    .forEach((idPath) =>
                        funs.add(idPath.vReferencedDeclaration as FunctionDefinition)
                    );
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

    const res = tc(expr.in, addScope(ctx, expr), typeEnv);

    if (res instanceof IntLiteralType) {
        throw new SGenericTypeError(
            `Type of let expression is not uniquely defined from its body. Please add a type cast around the body to define it. (e.g. uint(${expr.in.pp()}))`,
            expr
        );
    }

    return res;
}

/**
 * @todo Seems to need rework due to recent changes in solc-typed-ast.
 */
function matchArguments(
    inference: InferType,
    argTs: TypeNode[],
    callable: FunctionDefinition | VariableDeclaration | FunctionType | BuiltinFunctionType
) {
    let funT: FunctionType | BuiltinFunctionType;

    if (callable instanceof FunctionDefinition) {
        funT = inference.funDefToType(callable);
    } else if (callable instanceof VariableDeclaration) {
        funT = inference.getterFunType(callable);
    } else {
        funT = callable;
    }

    const isVariadic = funT.parameters.length > 0 && last(funT.parameters) instanceof TRest;

    // For non-variadic functions the number of arguments must match the number of formal parameters
    if (!isVariadic && argTs.length !== funT.parameters.length) {
        return false;
    }

    // For variadic functions the number of arguments must be at least the
    // number of formal parameters minus one (the variable types can match 0
    // types)
    if (isVariadic && argTs.length < funT.parameters.length - 1) {
        return false;
    }

    for (let i = 0; i < funT.parameters.length; i++) {
        const formalT = funT.parameters[i];

        if (formalT instanceof TRest) {
            assert(
                i === funT.parameters.length - 1,
                `Unexpected variable type not in last position of fun {0}`,
                funT
            );

            return true;
        }

        if (!castable(argTs[i], formalT, inference.version)) {
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
    const varT = tc(expr.iteratorVariable, addScope(ctx, expr), typeEnv);
    const uintT = new IntType(256, false);

    if (expr.container !== undefined) {
        // Case 1. Iterating over the keys/indices of a container
        const containerT = tc(expr.container, ctx, typeEnv);

        if (
            (containerT instanceof PointerType && containerT.to instanceof ArrayType) ||
            containerT instanceof FixedBytesType
        ) {
            if (!castable(expr.iteratorType, uintT, typeEnv.compilerVersion)) {
                throw new SWrongType(
                    `The type ${expr.iteratorType.pp()} of the iterator variable ${expr.iteratorVariable.pp()} is not castable to the array index type uint of ${expr.container.pp()}.`,
                    expr.iteratorVariable,
                    expr.iteratorType
                );
            }
        } else if (containerT instanceof PointerType && containerT.to instanceof MappingType) {
            const keyT = containerT.to.keyType;
            if (!castable(keyT, varT, typeEnv.compilerVersion)) {
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
        // Case 2. Iterating in a range [expr.start, expr.end]
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

        if (!castable(startT, expr.iteratorType, typeEnv.compilerVersion)) {
            throw new SWrongType(
                `The type for ${expr.iteratorVariable.pp()} is not compatible with the start range type ${startT.pp()}.`,
                expr.iteratorVariable,
                expr.iteratorType
            );
        }

        if (!castable(endT, expr.iteratorType, typeEnv.compilerVersion)) {
            throw new SWrongType(
                `The type for ${expr.iteratorVariable.pp()} is not compatible with the end range type ${endT.pp()}.`,
                expr.iteratorVariable,
                expr.iteratorType
            );
        }
    }

    const exprT = tc(expr.expression, addScope(ctx, expr), typeEnv);
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

    if (callee instanceof SId) {
        if (callee.name === ScribbleBuiltinFunctions.unchecked_sum) {
            callee.defSite = "builtin_fun";

            if (expr.args.length !== 1) {
                throw new SExprCountMismatch(
                    `Calls to sum expect a single argument, not ${
                        expr.args.length
                    } in ${expr.pp()}`,
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

        if (callee.name === ScribbleBuiltinFunctions.eq_encoded) {
            callee.defSite = "builtin_fun";

            if (expr.args.length !== 2) {
                throw new SExprCountMismatch(
                    `Calls to ${callee.name} expect 2 arguments, not ${
                        expr.args.length
                    } in ${expr.pp()}`,
                    expr
                );
            }

            const encoderVersion = typeEnv.inference.getUnitLevelAbiEncoderVersion(ctx.target);

            for (const arg of expr.args) {
                const argT = tc(arg, ctx, typeEnv);

                if (!typeEnv.inference.isABIEncodable(argT, encoderVersion)) {
                    throw new SWrongType(
                        `${arg.pp()} of type ${argT.pp()} is not encodable (can not be wrapped by abi.encode()) in ${expr.pp()}`,
                        expr,
                        argT
                    );
                }
            }

            return new BoolType();
        }

        if (callee.name === "type") {
            callee.defSite = "builtin_fun";

            if (expr.args.length !== 1) {
                throw new SExprCountMismatch(
                    `type() expects a single argument, not ${expr.args.length} in ${expr.pp()}`,
                    expr
                );
            }

            const argT = tc(expr.args[0], ctx, typeEnv);

            if (!(argT instanceof TypeNameType)) {
                throw new SWrongType(
                    `type() expects a type name as argument, not ${argT.pp()} in ${expr.pp()}`,
                    expr,
                    argT
                );
            }

            const underlyingType = argT.type;
            let typeFunT: BuiltinFunctionType | undefined;

            if (
                underlyingType instanceof IntType ||
                (underlyingType instanceof UserDefinedType &&
                    underlyingType.definition instanceof EnumDefinition)
            ) {
                typeFunT = applySubstitution(
                    typeInt,
                    new Map([["T", underlyingType]])
                ) as BuiltinFunctionType;
            }

            if (
                underlyingType instanceof UserDefinedType &&
                underlyingType.definition instanceof ContractDefinition
            ) {
                typeFunT = applySubstitution(
                    underlyingType.definition.kind === ContractKind.Interface ||
                        underlyingType.definition.abstract
                        ? typeInterface
                        : typeContract,
                    new Map([["T", underlyingType]])
                ) as BuiltinFunctionType;
            }

            if (typeFunT !== undefined) {
                return typeFunT.returns[0];
            }

            throw new SWrongType(
                `type() expects a contract name, numeric or enum type, not ${argT.pp()} in ${expr.pp()}`,
                expr,
                argT
            );
        }
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

    assert(callee instanceof SNode, `Unexpected type node {0} with type {1}`, callee, calleeT);

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

        // Filter the from the original set of (potentially overloaded) functions with the
        // same name just the functions that match the actual argTs in the call
        const matchingDefs: Array<[FunctionDefinition | VariableDeclaration, FunctionType]> =
            calleeT.definitions
                .map(
                    (def) =>
                        [
                            def,
                            def instanceof FunctionDefinition
                                ? typeEnv.inference.funDefToType(def)
                                : typeEnv.inference.getterFunType(def)
                        ] as [FunctionDefinition | VariableDeclaration, FunctionType]
                )
                .filter(([, funT]) => matchArguments(typeEnv.inference, argTs, funT));

        if (matchingDefs.length === 0) {
            throw new SUnresolvedFun(
                `Provided arguments ${expr.pp()} don't match any of candidate functions:\n\n` +
                    calleeT.definitions.map((def) => typeEnv.inference.signature(def)).join("\n"),
                expr
            );
        } else if (matchingDefs.length > 1) {
            // This is an internal error - shouldn't be encountered by normal user operations.
            throw new Error(
                `Multiple functions / public getters match callsite ${expr.pp()}: ${calleeT.pp()}`
            );
        }

        const [def, funT] = matchingDefs[0];
        // Narrow down the set of matching definitions in the callee's type.
        calleeT.definitions = [def];

        if (callee instanceof SId || callee instanceof SMemberAccess) {
            callee.defSite = def;
        }

        const retTs = funT.returns;

        if (retTs.length === 1) {
            return retTs[0];
        }

        if (retTs.length > 1) {
            return new TupleType(retTs);
        }

        throw new SFunNoReturn(`Function ${def.name} doesn't return a type`, expr);
    }

    // Builtin function
    if (calleeT instanceof FunctionType || calleeT instanceof BuiltinFunctionType) {
        const argTs = expr.args.map((arg) => tc(arg, ctx, typeEnv));

        if (!matchArguments(typeEnv.inference, argTs, calleeT)) {
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
