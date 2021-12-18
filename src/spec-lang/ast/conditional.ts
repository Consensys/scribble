import { NodeLocation, SNode } from "./node";

export class SConditional extends SNode {
    condition: SNode;
    trueExp: SNode;
    falseExp: SNode;

    constructor(condition: SNode, trueExp: SNode, falseExp: SNode, src?: NodeLocation) {
        super(src);
        this.condition = condition;
        this.trueExp = trueExp;
        this.falseExp = falseExp;
    }

    pp(): string {
        return `(${this.condition.pp()} ? ${this.falseExp.pp()} : ${this.falseExp.pp()})`;
    }

    getFields(): any[] {
        return [this.condition, this.trueExp, this.falseExp];
    }
}
