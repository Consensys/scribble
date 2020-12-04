import { SNode, Range } from "./node";

export class SMemberAccess extends SNode {
    base: SNode;
    member: string;

    constructor(base: SNode, member: string, src?: Range) {
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
