import { NodeLocation, SNode } from "./node";

export class SAddressLiteral extends SNode {
    public readonly val: string;

    constructor(val: string, src?: NodeLocation) {
        super(src);
        this.val = val;
    }

    pp(): string {
        return this.val;
    }

    getFields(): any[] {
        return [this.val];
    }
}
