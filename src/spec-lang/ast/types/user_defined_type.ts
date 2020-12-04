import { SType } from "./type";
import { StructDefinition, EnumDefinition, ContractDefinition } from "solc-typed-ast";
import { Range } from "..";

export type UserDefinition = StructDefinition | EnumDefinition | ContractDefinition;

export class SUserDefinedType extends SType {
    public readonly name: string;
    public definition?: UserDefinition;

    constructor(name: string, definition?: UserDefinition, src?: Range) {
        super(src);
        this.name = name;
        this.definition = definition;
    }

    pp(): string {
        return this.name;
    }

    getFields(): any[] {
        return [this.name];
    }
}
