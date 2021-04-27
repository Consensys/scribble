import { SNode, Range } from ".";
import { SIntType } from "./types";

/**
 */
export class SForAll extends SNode {
    public readonly itr_type;
    public readonly itr;
    public readonly start;
    public readonly end;
    public readonly start_bracket;
    public readonly end_bracket;
    public readonly expression;
    public readonly array;
    public readonly label?: string;
    constructor(
        itr_type: SIntType,
        itr: SNode,
        expression: SNode,
        start?: SNode,
        end?: SNode,
        start_bracket?: string,
        end_bracket?: string,
        array?: SNode,
        src?: Range
    ) {
        super(src);
        this.itr_type = itr_type;
        this.itr = itr;
        this.start = start;
        this.end = end;
        this.start_bracket = start_bracket;
        this.end_bracket = end_bracket;
        this.expression = expression;
        this.array = array;
    }
    includesStart(): boolean {
        return this.start_bracket == "[";
    }

    includesEnd(): boolean {
        return this.end_bracket == "]";
    }
    pp(): string {
        if (this.start) {
            return `(forall(${this.itr_type} ${this.itr.pp()} in ${this.start_bracket} ${
                this.start
            }...${this.end} ${this.end_bracket}) ${this.expression.pp()}`;
        } else {
            return `(forall(${this.itr_type} ${this.itr.pp()} in ${
                this.array
            }) ${this.expression.pp()}`;
        }
    }

    getFields(): any[] {
        return [
            this.itr_type,
            this.itr,
            this.expression,
            this.start_bracket,
            this.start,
            this.end,
            this.end_bracket,
            this.array
        ];
    }
}
