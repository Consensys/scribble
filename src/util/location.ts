import { SourceFile } from "./sources";
import { IdxToOffMap } from "./unicode";

const srcLocation = require("src-location");

// Location inside a file
export type Location = { offset: number; line: number; column: number; file: SourceFile };
// Range inside a file
export type Range = { start: Location; end: Location };

/// A src tripple as represented in the solidity AST: (start, length, fileIndex)
export type SrcTriple = [number, number, number];

export type PegsLoc = { offset: number; line: number; column: number };
export type PegsRange = { start: PegsLoc; end: PegsLoc };

export type LocOptions = {
    file: SourceFile;
    baseOff: number;
    baseLine: number;
    baseCol: number;
    idxToOffMap: IdxToOffMap;
};

/**
 * Given a location relative to the start of some string (in UTF-16 offsets)
 * adjust it to be relative to the start of the file (in UTF-8 byte offsets)
 */
export function adjustLocation(l: Location, options: LocOptions): void {
    const byteOff = options.idxToOffMap.get(l.offset);
    l.offset = (byteOff as number) + options.baseOff;
    l.column = l.column + (l.line === 1 ? options.baseCol - 1 : 0);
    l.line += options.baseLine;
    l.file = options.file;
}

/**
 * Given a range relative to the start of some string (in UTF-16 offsets)
 * adjust it to be relative to the start of the file (in UTF-8 byte offsets)
 */
export function adjustRange(r: Range, options: LocOptions): void {
    adjustLocation(r.start, options);
    adjustLocation(r.end, options);
}

/**
 * Build the Location struct from a PegsLoc. This is called during parsing,
 * and it temporarily uses offsets/line/columns relative to the start of the comment.
 * Also offsets are in terms of UTF-16 indices, not UTF-8 byte offsets. This is fixed
 * after parsing by adjustRange/adjustLocation
 */
function makeLocation(rawLoc: PegsLoc): Location {
    return {
        offset: rawLoc.offset,
        line: rawLoc.line,
        column: rawLoc.column,
        file: undefined as unknown as any
    };
}

export function makeRange(rawRange: PegsRange): Range {
    return {
        start: makeLocation(rawRange.start),
        end: makeLocation(rawRange.end)
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
