import { NodeLocation, SNode } from "./node";

const unitMultiplier = new Map<string, bigint>([
    ["wei", BigInt(1)],
    ["gwei", BigInt(1e9)],
    ["ether", BigInt(1e18)],
    ["seconds", BigInt(1)],
    ["minutes", BigInt(60)],
    ["hours", BigInt(3600)],
    ["days", BigInt(86400)],
    ["weeks", BigInt(604800)]
]);

export class SNumber extends SNode {
    public readonly num: bigint;
    public readonly radix: number;

    constructor(num: bigint, radix: number, src?: NodeLocation, type?: string) {
        super(src);

        this.radix = radix;

        if (type) {
            const multiplier = unitMultiplier.get(type);

            if (multiplier === undefined) {
                throw new Error("Unknown denomination unit: " + type);
            }

            this.num = num * multiplier;
        } else {
            this.num = num;
        }
    }

    pp(): string {
        let numStr = this.num.toString(this.radix);

        if (this.radix === 16) {
            if (numStr.length % 2 !== 0) {
                numStr = "0" + numStr;
            }

            return "0x" + numStr;
        }

        return numStr;
    }

    getFields(): any[] {
        return [this.num, this.radix];
    }
}
