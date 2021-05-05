import {
    TypeNode,
    FunctionDefinition,
    VariableDeclaration,
    Range,
    ContractDefinition
} from "solc-typed-ast";
import { SNode } from "../../ast";

/**
 * Internal class used during type-checking to carry information for the possible overloaded targets
 * of a callee, back to the callsite which can resolve based on the actual arguments.
 */
export class FunctionSetType extends TypeNode {
    public definitions: Array<FunctionDefinition | VariableDeclaration>;
    public readonly defaultArg: SNode | undefined;

    constructor(
        definitions: Array<FunctionDefinition | VariableDeclaration>,
        defaultArg: SNode | undefined = undefined,
        src?: Range
    ) {
        super(src);
        this.definitions = definitions;
        this.defaultArg = defaultArg;
    }

    pp(): string {
        return `<${this.definitions
            .map((def) => `${(def.vScope as ContractDefinition).name}.${def.name}`)
            .join(",")}>`;
    }

    getFields(): any[] {
        return [this.definitions.map((def) => def.id)];
    }
}
