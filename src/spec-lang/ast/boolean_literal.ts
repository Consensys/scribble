import { NodeLocation, SNode } from "./node";

export class SBooleanLiteral extends SNode {
    public readonly val: boolean;
    constructor(val: boolean, src?: NodeLocation) {
        super(src);
        this.val = val;
    }

    pp(): string {
        return String(this.val);
    }

    getFields(): any[] {
        return [this.val];
    }
}
