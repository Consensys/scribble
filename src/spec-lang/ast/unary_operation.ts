import { NodeLocation, SNode } from "./node";

export type UnaryOperator = "-" | "!" | "old";

export class SUnaryOperation extends SNode {
    public readonly op: UnaryOperator;
    public readonly subexp: SNode;

    constructor(op: UnaryOperator, subexp: SNode, src?: NodeLocation) {
        super(src);
        this.op = op;
        this.subexp = subexp;
    }

    pp(): string {
        if (this.op === "old") {
            return `old(${this.subexp.pp()})`;
        }

        return `(${this.op}${this.subexp.pp()})`;
    }

    getFields(): any[] {
        return [this.op, this.subexp];
    }
}
