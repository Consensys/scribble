import { SNode, Range } from "./node";

export class SResult extends SNode {
    constructor(src?: Range) {
        super(src);
    }

    pp(): string {
        return "$result";
    }

    getFields(): any[] {
        return [];
    }
}
