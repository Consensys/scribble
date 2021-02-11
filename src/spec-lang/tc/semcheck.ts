import { FunctionStateMutability, VariableDeclaration } from "solc-typed-ast";
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
    SUserFunctionDefinition
} from "../ast";
import { TypeMap } from "./typecheck";

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
}

export class SemError extends Error {
    constructor(msg: string, public readonly node: SNode) {
        super(msg);
    }

    loc(): Range {
        return this.node.src as Range;
    }
}

export function scAnnotation(
    node: SAnnotation,
    typings: TypeMap,
    semMap: SemMap = new Map()
): void {
    const ctx: SemCtx = { isOld: false };
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
    typings: TypeMap,
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

export function scId(expr: SId, ctx: SemCtx, typings: TypeMap, semMap: SemMap): SemInfo {
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
    typings: TypeMap,
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
    typings: TypeMap,
    semMap: SemMap
): SemInfo {
    if (expr.op === "old") {
        if (ctx.isOld) {
            throw new SemError(
                `Nested old() expressions not allowed: ${expr.pp()} is already inside an old()`,
                expr
            );
        }
    }

    return sc(expr.subexp, { isOld: expr.op === "old" }, typings, semMap);
}

export function scBinary(
    expr: SBinaryOperation,
    ctx: SemCtx,
    typings: TypeMap,
    semMap: SemMap
): SemInfo {
    const lhsInfo = sc(expr.left, ctx, typings, semMap);
    const rhsInfo = sc(expr.right, ctx, typings, semMap);

    const isOld = ctx.isOld;
    const isConst = lhsInfo.isConst && rhsInfo.isConst;
    const canFail = lhsInfo.canFail || rhsInfo.canFail || ["/", "%"].includes(expr.op);

    return { isOld, isConst, canFail };
}

export function scConditional(
    expr: SConditional,
    ctx: SemCtx,
    typings: TypeMap,
    semMap: SemMap
): SemInfo {
    const condInfo = sc(expr.condition, ctx, typings, semMap);
    const trueInfo = sc(expr.trueExp, ctx, typings, semMap);
    const falseInfo = sc(expr.falseExp, ctx, typings, semMap);

    const isOld = ctx.isOld;
    const isConst = condInfo.isConst && trueInfo.isConst && falseInfo.isConst;
    const canFail = condInfo.canFail || trueInfo.canFail || falseInfo.canFail;

    return { isOld, isConst, canFail };
}

export function scIndexAccess(
    expr: SIndexAccess,
    ctx: SemCtx,
    typings: TypeMap,
    semMap: SemMap
): SemInfo {
    const baseInfo = sc(expr.base, ctx, typings, semMap);
    const indexInfo = sc(expr.index, ctx, typings, semMap);

    const isOld = ctx.isOld;
    const isConst = baseInfo.isConst && indexInfo.isConst;
    const canFail = true;

    return { isOld, isConst, canFail };
}

export function scMemberAccess(
    expr: SMemberAccess,
    ctx: SemCtx,
    typings: TypeMap,
    semMap: SemMap
): SemInfo {
    const baseInfo = sc(expr.base, ctx, typings, semMap);

    const isOld = ctx.isOld;
    const isConst = baseInfo.isConst;
    const canFail = baseInfo.canFail;

    return { isOld, isConst, canFail };
}

export function scLet(expr: SLet, ctx: SemCtx, typings: TypeMap, semMap: SemMap): SemInfo {
    // Compute the info for the first RHS, so that it can be looked-up by scId
    // while computing the info for for expr.in.
    sc(expr.rhs, ctx, typings, semMap);

    return sc(expr.in, ctx, typings, semMap);
}

export function scFunctionCall(
    expr: SFunctionCall,
    ctx: SemCtx,
    typings: TypeMap,
    semMap: SemMap
): SemInfo {
    const callee = expr.callee;
    const calleeT = typings.get(callee) as SType;
    // First check the arguments
    expr.args.forEach((arg) => sc(arg, ctx, typings, semMap));

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
    sc(expr.callee, ctx, typings, semMap);

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
