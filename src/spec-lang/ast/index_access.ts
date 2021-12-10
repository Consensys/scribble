import { NodeLocation, SNode } from "./node";

export class SIndexAccess extends SNode {
    base: SNode;
    index: SNode;

    constructor(base: SNode, index: SNode, src?: NodeLocation) {
        super(src);
        this.base = base;
        this.index = index;
    }

    pp(): string {
        return `${this.base.pp()}[${this.index.pp()}]`;
    }

    getFields(): any[] {
        return [this.base, this.index];
    }
}
