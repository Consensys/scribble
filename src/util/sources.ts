export abstract class SourceFile {
    constructor(public fileName: string, public contents: string) {}
}

export class SolFile extends SourceFile {}
export class MacroFile extends SourceFile {}

export class DummySourceFile extends SourceFile {
    constructor() {
        super("", "");
    }
}

export type SourceMap = Map<string, SourceFile>;
