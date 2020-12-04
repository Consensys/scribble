import { SType } from "./type";
import { Range } from "..";

export class SBuiltinStructType extends SType {
    readonly name: string;
    readonly members: Map<string, SType>;

    constructor(name: string, members: Map<string, SType>, src?: Range) {
        super(src);

        this.name = name;
        this.members = members;
    }

    pp(): string {
        return `<builtin struct ${this.name}>`;
    }

    getFields(): any[] {
        return [this.name];
    }
}
