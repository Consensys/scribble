import { SType } from "./type";
import { FunctionDefinition, VariableDeclaration, ContractDefinition } from "solc-typed-ast";
import { SNode, Range } from "../node";

export class SFunctionSetType extends SType {
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
