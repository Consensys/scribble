import { NodeLocation, SNode } from "./node";

export class SResult extends SNode {
    constructor(src?: NodeLocation) {
        super(src);
    }

    pp(): string {
        return "$result";
    }

    getFields(): any[] {
        return [];
    }
}
