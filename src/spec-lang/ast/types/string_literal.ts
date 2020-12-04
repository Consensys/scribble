import { SType } from "./type";
import { Range } from "..";

export class SStringLiteralType extends SType {
    constructor(src?: Range) {
        super(src);
    }

    pp(): string {
        return `string_literal`;
    }

    getFields(): any[] {
        return [];
    }
}
