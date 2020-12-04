import { SNode, Range } from "./node";

export class SHexLiteral extends SNode {
    public readonly val: string;

    constructor(val: string, src?: Range) {
        super(src);

        this.val = val;
    }

    pp(): string {
        return `hex"${this.val}"`;
    }

    getFields(): any[] {
        return [this.val];
    }
}
