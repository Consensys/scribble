import { SourceFile } from "./sources";

const srcLocation = require("src-location");

// Location inside a file
export type Location = { offset: number; line: number; column: number; file: SourceFile };
// Range inside a file
export type Range = { start: Location; end: Location };

/// A src tripple as represented in the solidity AST: (start, length, fileIndex)
export type SrcTriple = [number, number, number];

type PegsLoc = { offset: number; line: number; column: number };
type PegsRange = { start: PegsLoc; end: PegsLoc };

export type LocOptions = {
    file: SourceFile;
    baseOff: number;
    baseLine: number;
    baseCol: number;
};

function makeLocation(rawLoc: PegsLoc, options: LocOptions): Location {
    return {
        offset: rawLoc.offset + options.baseOff,
        line: rawLoc.line + options.baseLine,
        column: rawLoc.column + (rawLoc.line === 1 ? options.baseCol - 1 : 0),
        file: options.file
    };
}

export function makeRange(rawRange: PegsRange, options: LocOptions): Range {
    return {
        start: makeLocation(rawRange.start, options),
        end: makeLocation(rawRange.end, options)
    };
}

export function indexToLocation(file: SourceFile, ind: number): Location {
    const t = srcLocation.indexToLocation(file.contents, ind, true);

    return { offset: ind, line: t.line, column: t.column, file };
}

export function rangeToLocRange(start: number, length: number, file: SourceFile): Range {
    return {
        start: indexToLocation(file, start),
        end: indexToLocation(file, start + length)
    };
}

export function ppLoc(l: Location): string {
    return `${l.file.fileName}:${l.line}:${l.column}`;
}

export function ppRange(r: Range): string {
    return `${r.start.file.fileName}:${r.start.line}:${r.start.column}-${r.end.line}-${r.end.column}`;
}
