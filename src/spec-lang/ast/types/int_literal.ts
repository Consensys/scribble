import { SType } from "./type";
import { Range } from "..";

export class SIntLiteralType extends SType {
    constructor(src?: Range) {
        super(src);
    }

    pp(): string {
        return `int_literal`;
    }

    getFields(): any[] {
        return [];
    }
}
