export type IdxToOffMap = Map<number, number>;

const utf8Enc = new TextEncoder();
const scratch = new Uint8Array(4);

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

export function isASCII(str: string): boolean {
    // eslint-disable-next-line no-control-regex
    return /^[\x00-\x7F]*$/.test(str);
}
