import { SNode, Range } from "./node";
import { BigInteger } from "big-integer";
import bigInt from "big-integer";

const unitMultiplier = new Map<string, BigInteger>([
    ["wei", bigInt(1)],
    ["gwei", bigInt(1e9)],
    ["ether", bigInt(1e18)],
    ["seconds", bigInt(1)],
    ["minutes", bigInt(60)],
    ["hours", bigInt(3600)],
    ["days", bigInt(86400)],
    ["weeks", bigInt(604800)]
]);

export class SNumber extends SNode {
    public readonly num: BigInteger;
    public readonly radix: number;

    constructor(num: BigInteger, radix: number, src?: Range, type?: string) {
        super(src);
        this.radix = radix;
        if (type) {
            const multiplier = unitMultiplier.get(type);
            if (multiplier === undefined) {
                throw new Error("Unknown denomination unit: " + type);
            }
            this.num = num.multiply(multiplier);
        } else {
            this.num = num;
        }
    }

    pp(): string {
        const prefix = this.radix === 16 ? "0x" : "";
        return prefix + this.num.toString(this.radix);
    }

    getFields(): any[] {
        return [this.num, this.radix];
    }
}
