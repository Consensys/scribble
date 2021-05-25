import { SNode, Range, SId, SNumber, SMemberAccess } from ".";
import { IntType } from "solc-typed-ast";
import bigInt from "big-integer";
import { assert } from "../../util";

/**
 * The Node that stores the information for ForAll.
 * examples-:
 * forall(type iteratorName in array) expression(iteratorName)
 * forall(type iteratorName in [start, end)) expression(iteratorName)
 */
export class SForAll extends SNode {
    /* Type of the iteration variable */
    public readonly iteratorType: IntType;

    /* Name of the iteration variable */
    public readonly iteratorVariable: SId;

    /* start range */
    public readonly start: SNode;

    /*  End range */
    public readonly end: SNode;

    /* condition on  which forall is applied */
    public readonly expression: SNode;

    /* Array on which iterator iterates */
    public readonly array?: SNode;

    constructor(
        iteratorType: IntType,
        iteratorVariable: SId,
        expression: SNode,
        start?: SNode,
        end?: SNode,
        array?: SId,
        src?: Range
    ) {
        super(src);
        this.iteratorType = iteratorType;
        this.iteratorVariable = iteratorVariable;
        this.array = array;

        if (array === undefined) {
            assert(
                start !== undefined && end !== undefined,
                `When array is not passed in, must specify start and end for forall`
            );
            this.start = start;
            this.end = end;
        } else {
            assert(
                start === undefined && end === undefined,
                `Can't specify both an array and start or end for forall.`
            );
            this.start = new SNumber(bigInt(0), 10);
            this.end = new SMemberAccess(array, "length");
        }

        this.expression = expression;
        this.array = array;
    }

    pp(): string {
        if (this.array === undefined) {
            return `(forall(${this.iteratorType.pp()} ${this.iteratorVariable.pp()} in ${this.start.pp()}...${this.end.pp()} ${this.expression.pp()}`;
        } else {
            return `(forall(${this.iteratorType.pp()} ${this.iteratorVariable.pp()} in ${this.array.pp()}) ${this.expression.pp()}`;
        }
    }

    getFields(): any[] {
        return [
            this.iteratorType,
            this.iteratorVariable,
            this.expression,
            this.start,
            this.end,
            this.array
        ];
    }
}
