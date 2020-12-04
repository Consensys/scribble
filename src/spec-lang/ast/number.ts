import { SNode, Range } from "./node";
import { BigInteger } from "big-integer";

export class SNumber extends SNode {
    public readonly num: BigInteger;
    public readonly radix: number;

    constructor(num: BigInteger, radix: number, src?: Range) {
        super(src);
        this.num = num;
        this.radix = radix;
    }

    pp(): string {
        const prefix = this.radix === 16 ? "0x" : "";
        return prefix + this.num.toString(this.radix);
    }

    getFields(): any[] {
        return [this.num, this.radix];
    }
}
