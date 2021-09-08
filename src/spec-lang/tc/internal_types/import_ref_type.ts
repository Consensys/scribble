import { assert, ImportDirective, TypeNode } from "solc-typed-ast";
import { Range } from "../../ast";

export class ImportRefType extends TypeNode {
    constructor(public readonly impStatement: ImportDirective, src?: Range) {
        super(src);
        assert(
            this.impStatement.vSymbolAliases.length === 0 && this.impStatement.unitAlias !== "",
            `ImportRefTypes only applicable to unit alias imports, not ${this.impStatement.print()}`
        );
    }

    getFields(): any[] {
        return [this.impStatement];
    }

    pp(): string {
        return `<import ${this.impStatement.vSourceUnit.sourceEntryKey} as ${this.impStatement.unitAlias}>`;
    }
}
