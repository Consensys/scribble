import { SType } from "./type";
import { Range } from "../node";

export class SIntType extends SType {
    nBits: number;
    signed: boolean;

    constructor(nBits: number, signed: boolean, src?: Range) {
        super(src);
        this.nBits = nBits;
        this.signed = signed;
    }

    pp(): string {
        return `${this.signed ? "" : "u"}int${this.nBits}`;
    }

    getFields(): any[] {
        return [this.nBits, this.signed];
    }
}
