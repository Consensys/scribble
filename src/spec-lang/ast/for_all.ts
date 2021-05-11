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
    public readonly _start?: SNode;

    /*  End range */
    public readonly _end?: SNode;

    /* Start bracket type, belongs to {'[', '('} */
    public readonly startBracket?: "[" | "(";

    /* End bracket type, belongs to {']', ')'} */
    public readonly endBracket?: "]" | ")";

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
        startBracket?: "[" | "(",
        endBracket?: "]" | ")",
        array?: SId,
        src?: Range
    ) {
        super(src);
        this.iteratorType = iteratorType;
        this.iteratorVariable = iteratorVariable;
        this._start = start;
        this._end = end;
        this.startBracket = startBracket;
        this.endBracket = endBracket;
        this.expression = expression;
        this.array = array;
    }
    start(): SNode {
        if (this._start) {
            return this._start;
        }
        return new SNumber(bigInt(0), 256);
    }

    end(): SNode {
        if (this._end) {
            return this._end;
        }
        assert(this.array !== undefined, "The array cannot be undefined when range is empty");
        return new SMemberAccess(this.array, "length");
    }

    pp(): string {
        if (this._start) {
            return `(forall(${this.iteratorType.pp()} ${this.iteratorVariable.pp()} in ${
                this.startBracket
            } ${this.start().pp()}...${this.end().pp()} ${
                this.endBracket
            }) ${this.expression.pp()}`;
        } else {
            assert(this.array != undefined, "The array cannot be undefined when range is empty");
            return `(forall(${this.iteratorType.pp()} ${this.iteratorVariable.pp()} in ${this.array.pp()}) ${this.expression.pp()}`;
        }
    }

    getFields(): any[] {
        return [
            this.iteratorType,
            this.iteratorVariable,
            this.expression,
            this.startBracket,
            this.start(),
            this.end(),
            this.endBracket,
            this.array
        ];
    }
}
