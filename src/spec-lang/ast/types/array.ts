import { SType } from "./type";
import { SReferenceType } from "./reference_type";
import { Range } from "..";

export class SArrayType extends SReferenceType {
    elementT: SType;
    size?: number;

    constructor(elementT: SType, size?: number, src?: Range) {
        super(src);
        this.elementT = elementT;
        this.size = size;
    }

    pp(): string {
        return `${this.elementT.pp()}[${this.size !== undefined ? this.size : ""}]`;
    }

    getFields(): any[] {
        return [this.elementT, this.size];
    }
}
