import { SNode, Range } from "./node";

export type PowerBinaryOperator = "**";
export type MultiplicativeBinaryOperator = "*" | "/" | "%";
export type AdditiveBinaryOperator = "+" | "-";
export type ShiftBinaryOperator = "<<" | ">>";
export type RelationalBinaryOperator = "<" | ">" | "<=" | ">=";
export type EqualityOperator = "==" | "!=";
export type BitwiseBinaryOperator = "&" | "|" | "^";
export type LogicalBinaryOperator = "&&" | "||";
export type ImplicationOperator = "==>";

export type BinaryOperator =
    | PowerBinaryOperator
    | MultiplicativeBinaryOperator
    | AdditiveBinaryOperator
    | ShiftBinaryOperator
    | RelationalBinaryOperator
    | EqualityOperator
    | BitwiseBinaryOperator
    | LogicalBinaryOperator
    | ImplicationOperator;

export class SBinaryOperation extends SNode {
    public readonly left: SNode;
    public readonly op: BinaryOperator;
    public readonly right: SNode;

    constructor(left: SNode, op: BinaryOperator, right: SNode, src?: Range) {
        super(src);
        this.left = left;
        this.op = op;
        this.right = right;
    }

    pp(): string {
        return `(${this.left.pp()} ${this.op} ${this.right.pp()})`;
    }

    getFields(): any[] {
        return [this.left, this.op, this.right];
    }
}
