import { SNode, Range } from "./node";

export class SFunctionCall extends SNode {
    callee: SNode;
    args: SNode[];

    constructor(callee: SNode, args: SNode[], src?: Range) {
        super(src);
        this.callee = callee;
        this.args = args;
    }

    pp(): string {
        return `${this.callee.pp()}(${this.args.map((arg) => arg.pp()).join(",")})`;
    }

    getFields(): any[] {
        return [this.callee, this.args];
    }
}
