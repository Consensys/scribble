import {
    ArrayType,
    assert,
    BuiltinFunctionType,
    BytesType,
    ContractDefinition,
    FunctionDefinition,
    FunctionStateMutability,
    FunctionType,
    MappingType,
    Mutability,
    PointerType,
    StringType,
    TypeNameType,
    VariableDeclaration
} from "solc-typed-ast";
import { AbsDatastructurePath, AnnotationMap, AnnotationMetaData, AnnotationTarget } from "../..";
import { single } from "../../util";
import {
    AnnotationType,
    NodeLocation,
    SAddressLiteral,
    SAnnotation,
    SBinaryOperation,
    SBooleanLiteral,
    SConditional,
    ScribbleBuiltinFunctions,
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
    SolidityBuiltinFunctions,
    SProperty,
    SResult,
    SStringLiteral,
    STryAnnotation,
    SUnaryOperation,
    SUserConstantDefinition,
    SUserFunctionDefinition
} from "../ast";
import { FunctionSetType } from "./internal_types";
import { TypeEnv } from "./typeenv";

export interface SemInfo {
    /**
     * Whether this particular expression is evaluated in the old or new context of a function
     */
    isOld: boolean;
    /**
     * Whether this particular expression is constant (across the function execution)
     */
    isConst: boolean;
    /**
     * Whether this particular expression may throw an exception during evaluation
     */
    canFail: boolean;
}

export type SemMap = Map<SNode, SemInfo>;

interface SemCtx {
    isOld: boolean;
    annotation: SAnnotation;
    annotationTarget: AnnotationTarget;
    interposingQueue: Array<[VariableDeclaration, AbsDatastructurePath]>;
}

export class SemError extends Error {
    public annotationMetaData!: AnnotationMetaData;

    constructor(
        msg: string,
        public readonly node: SNode
    ) {
        super(msg);
    }

    loc(): NodeLocation {
        return this.node.src as NodeLocation;
    }
}

export function scAnnotations(
    annotMap: AnnotationMap,
    typeEnv: TypeEnv,
    semMap: SemMap = new Map()
): Array<[VariableDeclaration, AbsDatastructurePath]> {
    const interposingQueue: Array<[VariableDeclaration, AbsDatastructurePath]> = [];
    const scHelper = (annotationMD: AnnotationMetaData): void => {
        try {
            scAnnotation(annotationMD.parsedAnnot, typeEnv, semMap, {
                isOld: false,
                annotation: annotationMD.parsedAnnot,
                annotationTarget: annotationMD.target,
                interposingQueue
            });
        } catch (e) {
            // Add the annotation metadata to the exception for pretty-printing
            if (e instanceof SemError) {
                e.annotationMetaData = annotationMD;
            }

            throw e;
        }
    };

    for (const [, annotations] of annotMap.entries()) {
        for (const annotation of annotations) {
            scHelper(annotation);
        }
    }

    return interposingQueue;
}

export function scAnnotation(
    node: SAnnotation,
    typings: TypeEnv,
    semMap: SemMap = new Map(),
    ctx: SemCtx
): void {
    if (node instanceof SProperty) {
        // #require is implicitly evaluated in the old-state
        if (node.type === AnnotationType.Require) {
            ctx.isOld = true;
        }

        sc(node.expression, ctx, typings, semMap);
    } else if (node instanceof STryAnnotation) {
        // #try is implicitly evaluated in the old-state
        ctx.isOld = true;

        for (const expr of node.exprs) {
            sc(expr, ctx, typings, semMap);
        }
    } else if (node instanceof SUserConstantDefinition) {
        const info = sc(node.value, ctx, typings, semMap);

        if (!info.isConst) {
            throw new SemError(
                `Cannot use non-constant expression ${node.value.pp()} in constant definition for ${
                    node.name.name
                }`,
                node
            );
        }
    } else if (node instanceof SUserFunctionDefinition) {
        sc(node.body, ctx, typings, semMap);
    } else if (node instanceof SLetAnnotation) {
        sc(node.expression, ctx, typings, semMap);
    } else {
        throw new Error(`NYI annotation ${node.pp()}`);
    }

    // #try/#require annotations on constructors cannot mention immutable state variables
    if (
        node instanceof SProperty &&
        (node.type === AnnotationType.Require || node.type === AnnotationType.Try) &&
        (ctx.annotationTarget instanceof ContractDefinition ||
            (ctx.annotationTarget instanceof FunctionDefinition &&
                ctx.annotationTarget.isConstructor))
    ) {
        node.walk((child) => {
            if (!(child instanceof SId || child instanceof SMemberAccess)) {
                return;
            }

            const def = child.defSite;

            if (!(def instanceof VariableDeclaration && def.stateVariable)) {
                return;
            }

            if (def.mutability === Mutability.Immutable) {
                throw new SemError(
                    `${
                        node.type
                    } annotation on constructor cannot use immutable state variable ${child.pp()}`,
                    child
                );
            }
        });
    }
}

export function sc(
    expr: SNode,
    ctx: SemCtx,
    typings: TypeEnv,
    semMap: SemMap = new Map()
): SemInfo {
    const cache = (expr: SNode, info: SemInfo): SemInfo => {
        semMap.set(expr, info);
        return info;
    };

    if (semMap.has(expr)) {
        return semMap.get(expr) as SemInfo;
    }

    if (expr instanceof SNumber) {
        return cache(expr, { isOld: ctx.isOld, isConst: true, canFail: false });
    }

    if (expr instanceof SBooleanLiteral) {
        return cache(expr, { isOld: ctx.isOld, isConst: true, canFail: false });
    }

    if (expr instanceof SStringLiteral) {
        return cache(expr, { isOld: ctx.isOld, isConst: true, canFail: false });
    }

    if (expr instanceof SHexLiteral) {
        return cache(expr, { isOld: ctx.isOld, isConst: true, canFail: false });
    }

    if (expr instanceof SAddressLiteral) {
        return cache(expr, { isOld: ctx.isOld, isConst: true, canFail: false });
    }

    if (expr instanceof SId) {
        return cache(expr, scId(expr, ctx, typings, semMap));
    }

    if (expr instanceof SResult) {
        return cache(expr, scResult(expr, ctx, typings, semMap));
    }

    if (expr instanceof SUnaryOperation) {
        return cache(expr, scUnary(expr, ctx, typings, semMap));
    }

    if (expr instanceof SBinaryOperation) {
        return cache(expr, scBinary(expr, ctx, typings, semMap));
    }

    if (expr instanceof SConditional) {
        return cache(expr, scConditional(expr, ctx, typings, semMap));
    }

    if (expr instanceof SIndexAccess) {
        return cache(expr, scIndexAccess(expr, ctx, typings, semMap));
    }

    if (expr instanceof SMemberAccess) {
        return cache(expr, scMemberAccess(expr, ctx, typings, semMap));
    }

    if (expr instanceof SLet) {
        return cache(expr, scLet(expr, ctx, typings, semMap));
    }

    if (expr instanceof SFunctionCall) {
        return cache(expr, scFunctionCall(expr, ctx, typings, semMap));
    }

    if (expr instanceof SForAll) {
        return cache(expr, scForAll(expr, ctx, typings, semMap));
    }

    throw new Error(`NYI semantic-checking of ${expr.pp()}`);
}

export function scId(expr: SId, ctx: SemCtx, typings: TypeEnv, semMap: SemMap): SemInfo {
    const def = expr.defSite;
    let isConst;
    let isOld = ctx.isOld;

    if (def instanceof VariableDeclaration) {
        isConst = def.constant;
    } else if (def instanceof Array) {
        const [defNode] = def;
        if (defNode instanceof SLet) {
            const defInfo = semMap.get(defNode.rhs) as SemInfo;

            isConst = defInfo.isConst;
            isOld = defInfo.isOld;
            if (ctx.isOld && !defInfo.isOld) {
                // Using a non-constant let-binding from a new context in an old expression is a semantic error
                if (!defInfo.isConst) {
                    throw new SemError(
                        `Variable ${
                            expr.name
                        } is defined in the new context in ${defNode.pp()} but used in an old() expression`,
                        expr
                    );
                }
                // Need to retro-actively make the constant let-binding "old"
                defInfo.isOld = true;
            }
        } else {
            /// SUserFunctionDefinition parameter
            isConst = false;
            isOld = false;
        }
    } else if (def instanceof SForAll) {
        isConst = false;
        isOld = ctx.isOld;
    } else if (def instanceof SUserConstantDefinition) {
        isConst = true;
    } else if (def === "function_name" || def === "type_name") {
        isConst = true;
    } else if (def === "this") {
        isConst = false;
    } else {
        isConst = false;
    }

    return { isOld: isOld, isConst: isConst, canFail: false };
}

export function scResult(
    expr: SResult,
    ctx: SemCtx,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    typeEnv: TypeEnv,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    semMap: SemMap
): SemInfo {
    if (ctx.isOld) {
        throw new SemError(`Cannot use ${expr.pp()} inside of old()`, expr);
    }

    if (ctx.annotation.type !== AnnotationType.IfSucceeds) {
        throw new SemError(
            `$result is only allowed in if_succeed annotations, not ${ctx.annotation.type}`,
            expr
        );
    }

    // Conservatively assume that result is never const.
    // Also referencing to the result itself after the function has returned should not fail.
    return { isOld: false, isConst: false, canFail: false };
}

export function scUnary(
    expr: SUnaryOperation,
    ctx: SemCtx,
    typeEnv: TypeEnv,
    semMap: SemMap
): SemInfo {
    const annotType = ctx.annotation.type;

    if (expr.op === "old") {
        const exprT = typeEnv.typeOf(expr);

        if (
            exprT instanceof PointerType &&
            (exprT.to instanceof ArrayType ||
                exprT.to instanceof MappingType ||
                exprT.to instanceof StringType ||
                exprT.to instanceof BytesType)
        ) {
            throw new SemError(
                `old() expressions over dynamically sized types (e.g. arrays, maps, strings, bytes) are not allowed`,
                expr
            );
        }

        if (
            !(
                ctx.annotation.type === AnnotationType.IfSucceeds ||
                ctx.annotation.type === AnnotationType.IfUpdated ||
                ctx.annotation.type === AnnotationType.IfAssigned
            )
        ) {
            let msgFollowup = "";
            if (annotType === AnnotationType.Try || annotType === AnnotationType.Require) {
                msgFollowup = ` ${annotType} always executes before the function call.`;
            }

            throw new SemError(
                `old() expressions not allowed in '${ctx.annotation.type}' annotations.${msgFollowup}`,
                expr
            );
        }

        if (ctx.isOld) {
            throw new SemError(
                `Nested old() expressions not allowed: ${expr.pp()} is already inside an old()`,
                expr
            );
        }

        if (
            (ctx.annotation.type === AnnotationType.IfAssigned ||
                ctx.annotation.type === AnnotationType.IfUpdated) &&
            ctx.annotationTarget instanceof VariableDeclaration &&
            ctx.annotationTarget.vValue
        ) {
            throw new SemError(
                `old() expressions not yet supported for state variable ${ctx.annotationTarget.name} with an ininine-initializer`,
                expr
            );
        }
    }

    const res = sc(
        expr.subexp,
        {
            isOld: expr.op === "old",
            annotation: ctx.annotation,
            annotationTarget: ctx.annotationTarget,
            interposingQueue: ctx.interposingQueue
        },
        typeEnv,
        semMap
    );

    // If the inner expression is constant we don't actually treat it as old when transpiling
    if (res.isConst) {
        res.isOld = false;
    }

    return res;
}

export function scBinary(
    expr: SBinaryOperation,
    ctx: SemCtx,
    typeEnv: TypeEnv,
    semMap: SemMap
): SemInfo {
    const lhsInfo = sc(expr.left, ctx, typeEnv, semMap);
    const rhsInfo = sc(expr.right, ctx, typeEnv, semMap);

    const isOld = ctx.isOld;
    const isConst = lhsInfo.isConst && rhsInfo.isConst;
    const canFail = lhsInfo.canFail || rhsInfo.canFail || ["/", "%"].includes(expr.op);

    return { isOld, isConst, canFail };
}

export function scConditional(
    expr: SConditional,
    ctx: SemCtx,
    typeEnv: TypeEnv,
    semMap: SemMap
): SemInfo {
    const condInfo = sc(expr.condition, ctx, typeEnv, semMap);
    const trueInfo = sc(expr.trueExp, ctx, typeEnv, semMap);
    const falseInfo = sc(expr.falseExp, ctx, typeEnv, semMap);

    const isOld = ctx.isOld;
    const isConst = condInfo.isConst && trueInfo.isConst && falseInfo.isConst;
    const canFail = condInfo.canFail || trueInfo.canFail || falseInfo.canFail;

    return { isOld, isConst, canFail };
}

export function scIndexAccess(
    expr: SIndexAccess,
    ctx: SemCtx,
    typeEnv: TypeEnv,
    semMap: SemMap
): SemInfo {
    const baseInfo = sc(expr.base, ctx, typeEnv, semMap);
    const indexInfo = sc(expr.index, ctx, typeEnv, semMap);

    const isOld = ctx.isOld;
    const isConst = baseInfo.isConst && indexInfo.isConst;
    const canFail = true;

    return { isOld, isConst, canFail };
}

export function scMemberAccess(
    expr: SMemberAccess,
    ctx: SemCtx,
    typeEnv: TypeEnv,
    semMap: SemMap
): SemInfo {
    const baseInfo = sc(expr.base, ctx, typeEnv, semMap);

    const isOld = ctx.isOld;
    const isConst = baseInfo.isConst;
    const canFail = baseInfo.canFail;

    return { isOld, isConst, canFail };
}

export function scLet(expr: SLet, ctx: SemCtx, typeEnv: TypeEnv, semMap: SemMap): SemInfo {
    // Compute the info for the first RHS, so that it can be looked-up by scId
    // while computing the info for for expr.in.
    sc(expr.rhs, ctx, typeEnv, semMap);

    return sc(expr.in, ctx, typeEnv, semMap);
}

export function scFunctionCall(
    expr: SFunctionCall,
    ctx: SemCtx,
    typeEnv: TypeEnv,
    semMap: SemMap
): SemInfo {
    const callee = expr.callee;

    // First check the arguments
    const argsInfo: SemInfo[] = expr.args.map((arg) => sc(arg, ctx, typeEnv, semMap));

    // Compute whether all args are constant
    const allArgsConst = argsInfo.every((argInfo) => argInfo.isConst);

    if (callee instanceof SId && callee.defSite === "builtin_fun") {
        if (callee.name === ScribbleBuiltinFunctions.unchecked_sum) {
            const arg = expr.args[0];
            const argT = typeEnv.typeOf(arg);
            const isOld = ctx.isOld || argsInfo[0].isOld;

            if (argT instanceof PointerType && argT.to instanceof MappingType) {
                const [sVar, path] = decomposeStateVarRef(unwrapOld(arg));
                if (sVar === undefined) {
                    throw new SemError(`Don't support forall over a map pointer ${arg.pp()}`, arg);
                }

                ctx.interposingQueue.push([sVar, path.map((x) => (x instanceof SNode ? null : x))]);
            }

            return { isOld: isOld, isConst: allArgsConst, canFail: argsInfo[0].canFail };
        }

        if (callee.name === ScribbleBuiltinFunctions.eq_encoded) {
            const isOld = ctx.isOld || argsInfo.every((argInfo) => argInfo.isOld);

            return {
                isOld: isOld,
                isConst: allArgsConst,
                canFail: argsInfo.some((argInfo) => argInfo.canFail)
            };
        }

        if (callee.name === SolidityBuiltinFunctions.type) {
            return { isOld: ctx.isOld, isConst: true, canFail: false };
        }
    }

    const calleeT = typeEnv.typeOf(callee);
    // Primitive cast
    if (calleeT instanceof TypeNameType) {
        return { isOld: ctx.isOld, isConst: allArgsConst, canFail: true };
    }

    assert(
        expr.callee instanceof SNode,
        `Unexpected type node {0} with type {1}`,
        expr.callee,
        calleeT
    );

    // sc the callee even if we don't use the result, to store its info in semMap
    sc(expr.callee, ctx, typeEnv, semMap);

    if (calleeT instanceof FunctionSetType) {
        const rawFun = single(calleeT.definitions);

        let isSideEffectFree: boolean;
        let isConst: boolean;

        if (rawFun instanceof VariableDeclaration) {
            isSideEffectFree = true;
            isConst = false;
        } else {
            isSideEffectFree = [
                FunctionStateMutability.Pure,
                FunctionStateMutability.View,
                FunctionStateMutability.Constant
            ].includes(rawFun.stateMutability);

            isConst = rawFun.stateMutability === FunctionStateMutability.Pure && allArgsConst;
        }

        if (!isSideEffectFree) {
            throw new SemError(
                `Cannot call function with side-effects ${callee.pp()} in ${expr.pp()}`,
                expr
            );
        }

        return { isOld: ctx.isOld, isConst, canFail: true };
    }

    if (calleeT instanceof FunctionType) {
        const isConst = calleeT.mutability === FunctionStateMutability.Pure && allArgsConst;

        return { isOld: ctx.isOld, isConst: isConst, canFail: true };
    }

    if (calleeT instanceof BuiltinFunctionType) {
        return { isOld: ctx.isOld, isConst: false, canFail: true };
    }

    throw new Error(`Internal error: NYI semcheck for ${expr.pp()}`);
}

type ConcreteDatastructureSPath = Array<string | SNode>;

export function unwrapOld(e: SNode): SNode {
    // Skip any old wrappers
    while (e instanceof SUnaryOperation && e.op === "old") {
        e = e.subexp;
    }

    return e;
}

export function decomposeStateVarRef(
    e: SNode
): [VariableDeclaration | undefined, ConcreteDatastructureSPath] {
    const path: ConcreteDatastructureSPath = [];

    while (true) {
        if (e instanceof SMemberAccess) {
            path.push(e.member);
            e = e.base;
            continue;
        }

        if (e instanceof SIndexAccess) {
            path.push(e.index);
            e = e.base;
            continue;
        }

        break;
    }

    path.reverse();

    // Normal state variable reference by name
    if (e instanceof SId && e.defSite instanceof VariableDeclaration && e.defSite.stateVariable) {
        return [e.defSite, path];
    }

    return [undefined, path];
}

/**
 * For Any expression of form old(e1) in `forall(type t in range) e(t)`
 * throw an error if the expression depends on t.
 */
export function scForAll(expr: SForAll, ctx: SemCtx, typeEnv: TypeEnv, semMap: SemMap): SemInfo {
    const startSemInfo = expr.start ? sc(expr.start, ctx, typeEnv, semMap) : undefined;
    const endSemInfo = expr.end ? sc(expr.end, ctx, typeEnv, semMap) : undefined;
    const containerSemInfo = expr.container ? sc(expr.container, ctx, typeEnv, semMap) : undefined;
    const exprSemInfo = sc(expr.expression, ctx, typeEnv, semMap);

    let canFail = exprSemInfo.canFail;
    let rangeIsOld = true;

    if (startSemInfo) {
        canFail ||= startSemInfo.canFail;
        rangeIsOld &&= startSemInfo.isOld;
    }

    if (endSemInfo) {
        canFail ||= endSemInfo.canFail;
        rangeIsOld &&= endSemInfo.isOld;
    }

    if (containerSemInfo) {
        canFail ||= containerSemInfo.canFail;
        rangeIsOld &&= containerSemInfo.isOld;
    }

    if (
        startSemInfo &&
        endSemInfo &&
        (startSemInfo.isOld || endSemInfo.isOld) &&
        !(startSemInfo.isOld && endSemInfo.isOld)
    ) {
        throw new SemError(
            `Cannot have one end of a range be in old() and the other not in ${expr.pp()}`,
            expr
        );
    }

    // We treat `forall (x in old(exp1)) old(exp2)` same as `old(forall (x in exp1) exp2)`
    const isOld = ctx.isOld || (rangeIsOld && exprSemInfo.isOld);

    // We dont support forall expressions over maps, where the container is a local pointer var, or
    // where the container is a state var that is aliased elsewhere
    if (expr.container !== undefined) {
        const containerT = typeEnv.typeOf(expr.container);
        if (containerT instanceof PointerType && containerT.to instanceof MappingType) {
            const [sVar, path] = decomposeStateVarRef(unwrapOld(expr.container));
            if (sVar === undefined) {
                throw new SemError(
                    `Don't support forall over a map pointer ${expr.container.pp()}`,
                    expr.container
                );
            }

            ctx.interposingQueue.push([sVar, path.map((x) => (x instanceof SNode ? null : x))]);
        }
    }

    if (!isOld) {
        expr.expression.walk((node) => {
            if (node instanceof SId && semMap.get(node)?.isOld && node.defSite === expr) {
                throw new SemError(
                    `Cannot use forall variable ${node.pp()} inside of an old() context since the whole forall is not in the old context.`,
                    expr
                );
            }
        });
    }

    return {
        isOld: isOld,
        isConst: exprSemInfo.isConst,
        canFail: canFail
    };
}
