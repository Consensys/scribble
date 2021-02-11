import { SType } from "./type";
import { UserDefinition } from "./user_defined_type";
import { Range } from "..";

/**
 * Type of the name of a user-defined type itself. For example in the
 * SMemberAccess `Contract.varName` the type of the `Contract` SId is
 * a `SUserDefinedTypeNameType`
 */
export class SUserDefinedTypeNameType extends SType {
    public readonly definition: UserDefinition;

    constructor(definition: UserDefinition, src?: Range) {
        super(src);
        this.definition = definition;
    }

    pp(): string {
        return `type(${this.definition.name})`;
    }

    getFields(): any[] {
        return [this.definition];
    }
}
