import { SNode, Range, SId, SNumber, SMemberAccess } from ".";
import { IntType } from "solc-typed-ast";
import bigInt from "big-integer";

/**
The Node that stores the information for ForAll.
examples-:
 forall(type iteratorName in array) expression(iteratorName)
 forall(type iteratorName in [start, end)) expression(iteratorName)
 */
export class SForAll extends SNode {
    /* Type of the iteration variable */
    public readonly iteratorType: IntType;

    /* Name of the iteration variable */
    public readonly iteratorVariable: SId;

    /* start range */
    public readonly start?: SNode;

    /*  End range */
    public readonly end?: SNode;

    /* Start bracket type, belongs to {'[', '('} */
    public readonly startBracket?: string;

    /* End bracket type, belongs to {']', ')'} */
    public readonly endBracket?: string;

    /* condition on  which forall is applied */
    public readonly expression: SNode;

    /* Array on which iterator iterates */
    public readonly array?: SNode;

    public readonly label?: string;

    constructor(
        iteratorType: IntType,
        iteratorVariable: SId,
        expression: SNode,
        start?: SNode,
        end?: SNode,
        startBracket?: "[" | "(",
        endBracket?: "]" | ")",
        array?: SId,
        src?: Range
    ) {
        super(src);
        this.iteratorType = iteratorType;
        this.iteratorVariable = iteratorVariable;
        this.start = start;
        this.end = end;
        this.startBracket = startBracket;
        this.endBracket = endBracket;
        this.expression = expression;
        this.array = array;
    }
    Start(): SNode {
        if (this.start) {
            return this.start;
        }
        return new SNumber(bigInt(0), 256);
    }

    End(): SNode {
        if (this.end) {
            return this.end;
        }
        return new SMemberAccess(this.array!, "length");
    }

    pp(): string {
        if (this.start) {
            return `(forall(${this.iteratorType} ${this.iteratorVariable.pp()} in ${
                this.startBracket
            } ${this.start}...${this.end} ${this.endBracket}) ${this.expression.pp()}`;
        } else {
            return `(forall(${this.iteratorType} ${this.iteratorVariable.pp()} in ${
                this.array
            }) ${this.expression.pp()}`;
        }
    }

    getFields(): any[] {
        return [
            this.iteratorType,
            this.iteratorVariable,
            this.expression,
            this.startBracket,
            this.start,
            this.end,
            this.endBracket,
            this.array
        ];
    }
}
