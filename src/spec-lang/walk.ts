import { SNode } from "./ast/node";
import {
    SType,
    SBinaryOperation,
    SBooleanLiteral,
    SConditional,
    SFunctionCall,
    SId,
    SIndexAccess,
    SLet,
    SMemberAccess,
    SNumber,
    SUnaryOperation
} from "./ast";

export class ReducerNotFound<T> extends Error {
    constructor(public readonly node: SNode, public readonly reducer: Reducer<T>) {
        super(
            `Cannot find walker for node ${node.pp()} of type ${
                node.constructor.name
            } in ${reducer}`
        );
    }
}

/**
 * Reducer interface for SNodes. It defines a set of callbacks to be called on
 * any node in a subtree. Together with the `reduce()` function it allows to
 * implement a functional reduce pattern.
 *
 * Note that currently a single callback for all types is defined. We can split this further in the future.
 */
export interface Reducer<T> {
    // Any Types
    type: (node: SType) => T;
    // Specific Expressions
    binaryOperation: (node: SBinaryOperation, left: T, right: T) => T;
    booleanLiteral: (node: SBooleanLiteral) => T;
    conditional: (node: SConditional, cond: T, ifTrue: T, ifFalse: T) => T;
    functionCall: (node: SFunctionCall, callee: T, args: T[]) => T;
    id: (node: SId) => T;
    indexAccess: (node: SIndexAccess, base: T, index: T) => T;
    let: (node: SLet, lhs: T[], rhs: T, inExp: T) => T;
    memberAccess: (node: SMemberAccess, base: T) => T;
    number: (node: SNumber) => T;
    unaryOperation: (node: SUnaryOperation, subExp: T) => T;
}

export function reduce<T>(n: SNode, reducer: Reducer<T>): T {
    if (n instanceof SType) {
        return reducer.type(n);
    }

    if (n instanceof SBinaryOperation) {
        const leftR = reduce(n.left, reducer);
        const rightR = reduce(n.right, reducer);
        return reducer.binaryOperation(n, leftR, rightR);
    }

    if (n instanceof SBooleanLiteral) {
        return reducer.booleanLiteral(n);
    }

    if (n instanceof SConditional) {
        const condR = reduce(n.condition, reducer);
        const ifTrueR = reduce(n.trueExp, reducer);
        const ifFalseR = reduce(n.falseExp, reducer);
        return reducer.conditional(n, condR, ifTrueR, ifFalseR);
    }

    if (n instanceof SFunctionCall) {
        const callee = reduce(n.callee, reducer);
        const args = n.args.map((arg) => reduce(arg, reducer));
        return reducer.functionCall(n, callee, args);
    }

    if (n instanceof SId) {
        return reducer.id(n);
    }

    if (n instanceof SIndexAccess) {
        const base = reduce(n.base, reducer);
        const index = reduce(n.index, reducer);
        return reducer.indexAccess(n, base, index);
    }

    if (n instanceof SLet) {
        const lhs = n.lhs.map((id) => reduce(id, reducer));
        const rhs = reduce(n.rhs, reducer);
        const inExp = reduce(n.in, reducer);
        return reducer.let(n, lhs, rhs, inExp);
    }

    if (n instanceof SMemberAccess) {
        const base = reduce(n.base, reducer);
        return reducer.memberAccess(n, base);
    }

    if (n instanceof SNumber) {
        return reducer.number(n);
    }

    if (n instanceof SUnaryOperation) {
        const subExp = reduce(n.subexp, reducer);
        return reducer.unaryOperation(n, subExp);
    }

    throw new ReducerNotFound(n, reducer);
}

/**
 * Walker interface for SNodes. It defines a set of optional callbacks to be
 * called on any node in a subtree. Toghether with the walk() function this
 * implements a visitor pattern.
 *
 * Note that for some nodes multiple callbacks apply. For example for an SBinaryOperation node, both the
 * binaryOperation, expression and default callbacks apply. Only the most specific callback will be called.
 */
export interface Walker {
    // Any node
    default?: (node: SNode) => void;
    // Any voidypes
    type?: (node: SType) => void;
    // Any expressions
    expression?: (node: SNode) => void;
    // Specific Expressions
    binaryOperation?: (node: SBinaryOperation) => void;
    booleanLiteral?: (node: SBooleanLiteral) => void;
    conditional?: (node: SConditional) => void;
    functionCall?: (node: SFunctionCall) => void;
    id?: (node: SId) => void;
    indexAccess?: (node: SIndexAccess) => void;
    let?: (node: SLet) => void;
    memberAccess?: (node: SMemberAccess) => void;
    number?: (node: SNumber) => void;
    unaryOperation?: (node: SUnaryOperation) => void;
}

export function walk(n: SNode, walker: Walker): void {
    if (n instanceof SType) {
        if (walker.type) walker.type(n);
    } else if (n instanceof SBinaryOperation) {
        walk(n.left, walker);
        walk(n.right, walker);

        if (walker.binaryOperation) walker.binaryOperation(n);
    } else if (n instanceof SBooleanLiteral) {
        if (walker.booleanLiteral) walker.booleanLiteral(n);
    } else if (n instanceof SConditional) {
        walk(n.condition, walker);
        walk(n.trueExp, walker);
        walk(n.falseExp, walker);
        if (walker.conditional) walker.conditional(n);
    } else if (n instanceof SFunctionCall) {
        walk(n.callee, walker);
        n.args.map((arg) => walk(arg, walker));
        if (walker.functionCall) walker.functionCall(n);
    } else if (n instanceof SId) {
        if (walker.id) walker.id(n);
    } else if (n instanceof SIndexAccess) {
        walk(n.base, walker);
        walk(n.index, walker);
        if (walker.indexAccess) walker.indexAccess(n);
    } else if (n instanceof SLet) {
        n.lhs.map((id) => walk(id, walker));
        walk(n.rhs, walker);
        walk(n.in, walker);
        if (walker.let) walker.let(n);
    } else if (n instanceof SMemberAccess) {
        walk(n.base, walker);
        if (walker.memberAccess) walker.memberAccess(n);
    } else if (n instanceof SNumber) {
        if (walker.number) walker.number(n);
    } else if (n instanceof SUnaryOperation) {
        walk(n.subexp, walker);
        if (walker.unaryOperation) walker.unaryOperation(n);
    } else if (walker.default) {
        walker.default(n);
    }
}
