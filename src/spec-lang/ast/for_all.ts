import { SNode, Range } from ".";
import { SItrRange } from "./range_node"
import { SIntType } from "./types";

/**
 */
export class SForAll extends SNode {
    public readonly itr_type;
    public readonly itr;
    public readonly range;
    public readonly expression;
    public readonly label?: string;
    constructor(itr_type: SIntType, itr: SNode, range: SItrRange, expression: SNode, src?: Range) {
        super(src);
        this.itr_type = itr_type
        this.itr = itr;
        this.range = range;
        this.expression = expression
    }

    pp(): string {
        return `(forall(${this.itr_type} ${this.itr.pp()} in ${this.range.pp()}) ${this.expression.pp()}`;
    }

    getFields(): any[] {
        return [this.itr_type, this.itr, this.range, this.expression];
    }
}
