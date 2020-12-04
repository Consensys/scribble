import { SNode, Range } from "./node";

export class SStringLiteral extends SNode {
    public readonly val: string;

    constructor(val: string, src?: Range) {
        super(src);

        this.val = val;
    }

    pp(): string {
        return JSON.stringify(this.val);
    }

    getFields(): any[] {
        return [this.val];
    }
}
