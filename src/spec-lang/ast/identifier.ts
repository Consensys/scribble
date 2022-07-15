import { ImportDirective, VariableDeclaration } from "solc-typed-ast";
import { SForAll, SLet } from ".";
import { StateVarScope } from "../tc";
import { SLetAnnotation, SUserConstantDefinition, SUserFunctionDefinition } from "./declarations";
import { NodeLocation, SNode } from "./node";

export type VarDefSite =
    | VariableDeclaration
    | [SLet, number]
    | [SUserFunctionDefinition, number]
    | [StateVarScope, number]
    | SForAll
    | SLetAnnotation;

export type IdDefSite =
    | VarDefSite
    | "function_name"
    | "type_name"
    | "this"
    | SUserFunctionDefinition
    | SUserConstantDefinition
    | "builtin_fun"
    | ImportDirective;

export class SId extends SNode {
    name: string;

    /**
     * AST Node corresponding to the definition for this SId. This is set during type-checking
     */
    defSite?: IdDefSite;

    constructor(name: string, src?: NodeLocation) {
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
