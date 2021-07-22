import { SNode, Range, SId } from ".";
import { TypeNode } from "solc-typed-ast";
import { assert } from "../../util";

/**
 * The Node that stores the information for ForAll.
 * examples-:
 * forall(type iteratorName in array) expression(iteratorName)
 * forall(type iteratorName in [start, end)) expression(iteratorName)
 */
export class SForAll extends SNode {
    /* Type of the iteration variable */
    public readonly iteratorType: TypeNode;

    /* Name of the iteration variable */
    public readonly iteratorVariable: SId;

    /* start range */
    public readonly start?: SNode;

    /*  End range */
    public readonly end?: SNode;

    /* condition on  which forall is applied */
    public readonly expression: SNode;

    /* CONTAINER on which iterator iterates */
    public readonly container?: SNode;

    constructor(
        iteratorType: TypeNode,
        iteratorVariable: SId,
        expression: SNode,
        start?: SNode,
        end?: SNode,
        container?: SId,
        src?: Range
    ) {
        super(src);
        this.iteratorType = iteratorType;
        this.iteratorVariable = iteratorVariable;
        this.container = container;

        if (container === undefined) {
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
        }

        this.expression = expression;
        this.container = container;
    }

    pp(): string {
        if (this.container === undefined) {
            return `(forall(${this.iteratorType.pp()} ${this.iteratorVariable.pp()} in ${(
                this.start as SNode
            ).pp()}...${(this.end as SNode).pp()} ${this.expression.pp()}`;
        }

        return `(forall(${this.iteratorType.pp()} ${this.iteratorVariable.pp()} in ${this.container.pp()}) ${this.expression.pp()}`;
    }

    getFields(): any[] {
        return [
            this.iteratorType,
            this.iteratorVariable,
            this.expression,
            this.start,
            this.end,
            this.container
        ];
    }
}
