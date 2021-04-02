import { FunctionStateMutability, SourceUnit, VariableDeclaration } from "solc-typed-ast";
import { AnnotationMap, AnnotationMetaData } from "../..";
import { single } from "../../util";
import {
    Range,
    SBinaryOperation,
    SBooleanLiteral,
    SConditional,
    SFunctionCall,
    SFunctionSetType,
    SFunctionType,
    SHexLiteral,
    SId,
    SIndexAccess,
    SLet,
    SMemberAccess,
    SNode,
    SNumber,
    SStringLiteral,
    SBuiltinTypeNameType,
    SType,
    SUserDefinedTypeNameType,
    SUnaryOperation,
    SAddressLiteral,
    SResult,
    SAnnotation,
    SProperty,
    SUserFunctionDefinition,
    AnnotationType
} from "../ast";
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

export interface SemCtx {
    isOld: boolean;
    annotation: SAnnotation;
}

export class SemError extends Error {
    public annotationMetaData!: AnnotationMetaData;
    constructor(msg: string, public readonly node: SNode) {
        super(msg);
    }

    loc(): Range {
        return this.node.src as Range;
    }
}

export function scUnits(
    units: SourceUnit[],
    annotMap: AnnotationMap,
    typeEnv: TypeEnv,
    semMap: SemMap = new Map()
): void {
    const scHelper = (annotationMD: AnnotationMetaData): void => {
        try {
            scAnnotation(annotationMD.parsedAnnot, typeEnv, semMap, {
                isOld: false,
                annotation: annotationMD.parsedAnnot
            });
        } catch (e) {
            // Add the annotation metadata to the exception for pretty-printing
            if (e instanceof SemError) {
                e.annotationMetaData = annotationMD;
            }

            throw e;
        }
    };

    for (const unit of units) {
        for (const contract of unit.vContracts) {
            // First semantic-check contract-level annotations
            for (const contractAnnot of annotMap.get(contract) as AnnotationMetaData[]) {
                scHelper(contractAnnot);
            }

            // Next semantic-check any state var annotations
            for (const stateVar of contract.vStateVariables) {
                for (const svAnnot of annotMap.get(stateVar) as AnnotationMetaData[]) {
                    scHelper(svAnnot);
                }
            }

            // Finally semantic-check any function annotations
            for (const funDef of contract.vFunctions) {
                for (const funAnnot of annotMap.get(funDef) as AnnotationMetaData[]) {
                    scHelper(funAnnot);
                }
            }
        }
    }
}

export function scAnnotation(
    node: SAnnotation,
    typings: TypeEnv,
    semMap: SemMap = new Map(),
    ctx: SemCtx
): void {
    if (node instanceof SProperty) {
        sc(node.expression, ctx, typings, semMap);
    } else if (node instanceof SUserFunctionDefinition) {
        sc(node.body, ctx, typings, semMap);
    } else {
        throw new Error(`NYI annotation ${node.pp()}`);
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
            isOld = defInfo.isOld || (ctx.isOld && isConst);
            // Using a non-constant let-binding from a new context in an old expression is a semantic error
            if (ctx.isOld && !defInfo.isOld && !isConst) {
                throw new SemError(
                    `Variable ${
                        expr.name
                    } is defined in the new context in ${defNode.pp()} but used in an old() expression`,
                    expr
                );
            }
        } else {
            /// SUserFunctionDefinition parameter
            isConst = false;
            isOld = false;
        }
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
    if (expr.op === "old") {
        if (ctx.isOld) {
            throw new SemError(
                `Nested old() expressions not allowed: ${expr.pp()} is already inside an old()`,
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
            throw new SemError(
                `old() expressions not allowed in ${ctx.annotation.type} annotations`,
                expr
            );
        }
    }

    return sc(
        expr.subexp,
        { isOld: expr.op === "old", annotation: ctx.annotation },
        typeEnv,
        semMap
    );
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
    const calleeT = typeEnv.typeOf(callee);
    // First check the arguments
    expr.args.forEach((arg) => sc(arg, ctx, typeEnv, semMap));

    // Compute whether all args are constant
    const allArgsConst = expr.args
        .map((arg) => (semMap.get(arg) as SemInfo).isConst)
        .reduce((a, b) => a && b, true);

    // Primitive cast
    if (callee instanceof SType || calleeT instanceof SBuiltinTypeNameType) {
        return { isOld: ctx.isOld, isConst: allArgsConst, canFail: true };
    }

    // User-defined Type cast
    if (calleeT instanceof SUserDefinedTypeNameType) {
        return { isOld: ctx.isOld, isConst: allArgsConst, canFail: true };
    }

    // sc the callee even if we don't use the result, to store its info in semMap
    sc(expr.callee, ctx, typeEnv, semMap);

    if (calleeT instanceof SFunctionSetType) {
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

    if (calleeT instanceof SFunctionType) {
        const isConst = calleeT.mutability === FunctionStateMutability.Pure && allArgsConst;
        return { isOld: ctx.isOld, isConst: isConst, canFail: true };
    }

    throw new Error(`Internal error: NYI semcheck for ${expr.pp()}`);
}
