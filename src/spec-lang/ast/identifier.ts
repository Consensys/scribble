import { SNode, Range } from "./node";
import { ImportDirective, VariableDeclaration } from "solc-typed-ast";
import { SLet, SForAll } from ".";
import { SUserFunctionDefinition } from "./declarations";
import { StateVarScope } from "../tc";

export type VarDefSite =
    | VariableDeclaration
    | [SLet, number]
    | [SUserFunctionDefinition, number]
    | [StateVarScope, number]
    | SForAll;

export type IdDefSite =
    | VarDefSite
    | "function_name"
    | "type_name"
    | "this"
    | SUserFunctionDefinition
    | "builtin_fun"
    | ImportDirective;

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
