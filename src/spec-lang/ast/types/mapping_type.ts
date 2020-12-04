import { SType } from "./type";
import { Range } from "..";

export class SMappingType extends SType {
    public readonly keyType: SType;
    public readonly valueType: SType;

    constructor(keyType: SType, valueType: SType, src?: Range) {
        super(src);
        this.keyType = keyType;
        this.valueType = valueType;
    }

    pp(): string {
        return `mapping (${this.keyType.pp()} => ${this.valueType.pp()})`;
    }

    getFields(): any[] {
        return [this.keyType, this.valueType];
    }
}
