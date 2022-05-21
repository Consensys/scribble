export abstract class SourceFile {
    constructor(public fileName: string, public contents: string) {}
}

export class SolFile extends SourceFile {}
export class MacroFile extends SourceFile {}

export class UtilsSolFile extends SourceFile {
    constructor(fileName: string) {
        super(fileName, "");
    }
}

export class DummySourceFile extends SourceFile {
    constructor() {
        super("", "");
    }
}

export type SourceMap = Map<string, SourceFile>;
