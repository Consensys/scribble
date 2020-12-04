import { SType } from "./type";
import { Range } from "..";

export class SBuiltinTypeNameType extends SType {
    public readonly type: SType;

    constructor(type: SType, src?: Range) {
        super(src);
        this.type = type;
    }

    pp(): string {
        return `type(${this.type.pp()})`;
    }

    getFields(): any[] {
        return [this.type];
    }
}
