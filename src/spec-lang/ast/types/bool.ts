import { SType } from "./type";
import { Range } from "../node";

export class SBoolType extends SType {
    constructor(src?: Range) {
        super(src);
    }

    pp(): string {
        return `bool`;
    }

    getFields(): any[] {
        return [];
    }
}
