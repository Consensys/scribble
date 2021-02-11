import { SNode, Range } from "./node";
import { VariableDeclaration } from "solc-typed-ast";
import { SLet } from ".";
import { SUserFunctionDefinition } from "./declarations";

export type VarDefSite = VariableDeclaration | [SLet, number] | [SUserFunctionDefinition, number];
export type IdDefSite = VarDefSite | "function_name" | "type_name" | "this";

export class SId extends SNode {
    public readonly name: string;
    /**
     * AST Node corresponding to the definition for this SId. This is set during type-checking
     */
    public defSite?: IdDefSite;

    constructor(name: string, src?: Range) {
        super(src);
        this.name = name;
    }

    pp(): string {
        return this.name;
    }

    getFields(): any[] {
        return [this.name];
    }
}
