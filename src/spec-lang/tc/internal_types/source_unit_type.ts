import { ImportDirective, TypeNode } from "solc-typed-ast";
import { Range } from "../../ast";

export class ImportRefType extends TypeNode {
    constructor(public readonly impStatement: ImportDirective, src?: Range) {
        super(src);
    }

    getFields(): any[] {
        return [this.impStatement];
    }

    pp(): string {
        return `<import ${this.impStatement.vSourceUnit.sourceEntryKey} as ${this.impStatement.unitAlias}>`;
    }
}
