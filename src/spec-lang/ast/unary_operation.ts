import { SNode, Range } from "./node";

export type UnaryOperator = "-" | "!" | "old";

export class SUnaryOperation extends SNode {
    public readonly op: UnaryOperator;
    public readonly subexp: SNode;

    constructor(op: UnaryOperator, subexp: SNode, src?: Range) {
        super(src);
        this.op = op;
        this.subexp = subexp;
    }

    pp(): string {
        if (this.op === "old") {
            return `old(${this.subexp.pp()})`;
        } else {
            return `(${this.op}${this.subexp.pp()})`;
        }
    }
    getFields(): any[] {
        return [this.op, this.subexp];
    }
}
