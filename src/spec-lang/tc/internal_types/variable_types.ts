import { TypeNode } from "solc-typed-ast";

/**
 * Place-holder type that can match any number of types. Used in the
 * args of variadic builtin functions: abi.encode*
 */
export class VariableTypes extends TypeNode {
    getFields(): any {
        return [];
    }

    pp(): string {
        return "<any types>";
    }
}
