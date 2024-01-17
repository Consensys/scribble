export type IdxToOffMap = Map<number, number>;

const utf8Enc = new TextEncoder();
const scratch = new Uint8Array(4);

export function strUTF8Len(s: string): number {
    let len = 0;
    for (const ch of s) {
        len += utf8Enc.encodeInto(ch, scratch).written;
    }

    return len;
}

/**
 * Get the UTF-8 encoding byte offset of the unicode character at index i in s.
 */
export function strUTF16IndexToUTF8Offset(s: string, idx: number): number {
    let i = 0,
        off = 0;

    for (const ch of s) {
        if (i === idx) {
            return off;
        }

        const charBytes = utf8Enc.encodeInto(ch, scratch).written;

        i += charBytes <= 2 ? 1 : 2;
        off += charBytes;

        if (i === idx) {
            return off;
        }

        if (i >= idx) {
            throw new Error(`No unicode character index ${idx} in string ${s}.`);
        }
    }

    if (i === idx) {
        return off;
    }

    throw new Error(`No unicode character index ${idx} in string ${s}.`);
}

/**
 * Build a map from UTF-16 encoded string indices to their byte offsets in the
 * corresponding UTF-8 encoding.
 */
export function makeIdxToOffMap(s: string): IdxToOffMap {
    const res: IdxToOffMap = new Map();
    let i = 0,
        off = 0;

    for (const ch of s) {
        res.set(i, off);
        const charBytes = utf8Enc.encodeInto(ch, scratch).written;

        i += charBytes <= 2 ? 1 : 2;
        off += charBytes;
    }

    res.set(i, off);

    return res;
}
