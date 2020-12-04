import { SNode, Range } from "./node";

export class SBooleanLiteral extends SNode {
    public readonly val: boolean;
    constructor(val: boolean, src?: Range) {
        super(src);
        this.val = val;
    }

    pp(): string {
        return "" + this.val;
    }

    getFields(): any[] {
        return [this.val];
    }
}
