import { SNode, Range, SId } from ".";
import { IntType } from "solc-typed-ast";

/**
 */
export class SForAll extends SNode {
    public readonly itrType: IntType;
    public readonly itr: SId;
    public readonly start?: SNode;
    public readonly end?: SNode;
    public readonly startBracket?: string;
    public readonly endBracket?: string;
    public readonly expression: SNode;
    public readonly array?: SId;
    public readonly label?: string;

    constructor(
        itrType: IntType,
        itr: SId,
        expression: SNode,
        start?: SNode,
        end?: SNode,
        startBracket?: string,
        endBracket?: string,
        array?: SId,
        src?: Range
    ) {
        super(src);
        this.itrType = itrType;
        this.itr = itr;
        this.start = start;
        this.end = end;
        this.startBracket = startBracket;
        this.endBracket = endBracket;
        this.expression = expression;
        this.array = array;
    }
    includesStart(): boolean {
        return this.startBracket == "[";
    }

    includesEnd(): boolean {
        return this.endBracket == "]";
    }
    pp(): string {
        if (this.start) {
            return `(forall(${this.itrType} ${this.itr.pp()} in ${this.startBracket} ${
                this.start
            }...${this.end} ${this.endBracket}) ${this.expression.pp()}`;
        } else {
            return `(forall(${this.itrType} ${this.itr.pp()} in ${
                this.array
            }) ${this.expression.pp()}`;
        }
    }

    getFields(): any[] {
        return [
            this.itrType,
            this.itr,
            this.expression,
            this.startBracket,
            this.start,
            this.end,
            this.endBracket,
            this.array
        ];
    }
}
