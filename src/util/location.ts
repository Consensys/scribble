import { SourceFile } from "./sources";

const srcLocation = require("src-location");

// Location inside a file
export type Location = { offset: number; line: number; column: number; file: SourceFile };
// Range inside a file
export type Range = { start: Location; end: Location };

/// TODO: Revisit the below two type names, either rename or add more comments
export type SrcTriple = [number, number, number];

export type OffsetRange = [number, number];

export function offsetBy<T extends OffsetRange | SrcTriple>(
    a: T,
    b: number | OffsetRange | SrcTriple
): T {
    const off = typeof b === "number" ? b : b[0];
    return (a.length === 2 ? [a[0] + off, a[1]] : [a[0] + off, a[1], a[2]]) as T;
}

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

function indexToLocation(file: SourceFile, ind: number): Location {
    const t = srcLocation.indexToLocation(file.contents, ind, true);

    return { offset: ind, line: t.line, column: t.column, file };
}

export function rangeToLocRange(start: number, length: number, file: SourceFile): Range {
    return {
        start: indexToLocation(file, start),
        end: indexToLocation(file, start + length)
    };
}

/**
 * Convert a line/column source range into an offset range
 */
export function rangeToOffsetRange(r: Range): OffsetRange {
    return [r.start.offset, r.end.offset - r.start.offset];
}