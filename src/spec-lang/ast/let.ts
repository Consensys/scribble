import { NodeLocation, SNode } from "./node";
import { SId } from ".";

export class SLet extends SNode {
    lhs: SId[];
    rhs: SNode;
    in: SNode;

    constructor(lhs: SId[], rhs: SNode, inExp: SNode, src?: NodeLocation) {
        super(src);
        this.lhs = lhs;
        this.rhs = rhs;
        this.in = inExp;
    }

    pp(): string {
        return `(let ${this.lhs
            .map((v) => v.pp())
            .join(",")} := ${this.rhs.pp()} in ${this.in.pp()})`;
    }

    getFields(): any[] {
        return [...this.lhs, this.rhs, this.in];
    }
}
