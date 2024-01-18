import { bytesToString } from "solc-typed-ast";

export abstract class SourceFile {
    public readonly contents;
    constructor(
        public fileName: string,
        public rawContents: Uint8Array
    ) {
        this.contents = bytesToString(rawContents);
    }
}

export class SolFile extends SourceFile {}
export class MacroFile extends SourceFile {}

export class UtilsSolFile extends SourceFile {
    constructor(fileName: string) {
        super(fileName, new Uint8Array());
    }
}

export class DummySourceFile extends SourceFile {
    constructor() {
        super("", new Uint8Array());
    }
}

export type SourceMap = Map<string, SourceFile>;
