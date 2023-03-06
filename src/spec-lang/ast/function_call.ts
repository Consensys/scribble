import { NodeLocation, SNode } from "./node";
import { TypeNode } from "solc-typed-ast";

export class SFunctionCall extends SNode {
    callee: SNode | TypeNode;
    args: SNode[];

    constructor(callee: SNode, args: SNode[], src?: NodeLocation) {
        super(src);
        this.callee = callee;
        this.args = args;
    }

    pp(): string {
        return `${this.callee.pp()}(${this.args.map((arg) => arg.pp()).join(",")})`;
    }

    getFields(): any[] {
        return [this.callee, ...this.args];
    }
}
