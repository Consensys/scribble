import { ExportedSymbol } from "solc-typed-ast";
import { NodeLocation, SNode } from "./node";

export class SMemberAccess extends SNode {
    base: SNode;
    member: string;
    public defSite?: ExportedSymbol;

    constructor(base: SNode, member: string, src?: NodeLocation) {
        super(src);
        this.base = base;
        this.member = member;
    }

    pp(): string {
        return `${this.base.pp()}.${this.member}`;
    }

    getFields(): any[] {
        return [this.base, this.member];
    }
}
