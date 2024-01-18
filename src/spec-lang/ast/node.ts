import { assert, PPAble, StructEqualityComparable, bytesToString } from "solc-typed-ast";
import { Range } from "../../util/location";

let nNodes = 0;

/**
 * This type represents the location of an annotations instantiated from a macro file.
 * The first `Range` in the tuple represent the location of the property inside the macro yaml file.
 * The second `Range` in the tuple represents the location of the `macro ...` annotation that caused the
 *  macro annotation to be instantiated.
 */
export type InstantiatedMacroLoc = [Range, Range];
/**
 * A node location can either be a source range (corrseponding to the annotation source inside the original .sol file)
 * Or a pair of ranges (see comment above `InstantiatedMacroLoc` for details.)
 */
export type NodeLocation = Range | InstantiatedMacroLoc;

export function isMacroLoc(loc: NodeLocation): loc is InstantiatedMacroLoc {
    return loc instanceof Array;
}

// Low-level AST Nodes
export abstract class SNode implements StructEqualityComparable, PPAble {
    readonly id: number;
    src?: NodeLocation;

    constructor(src?: NodeLocation) {
        this.id = nNodes++;
        this.src = src;
    }

    abstract pp(): string;
    abstract getFields(): any[];

    getChildren(): SNode[] {
        return this.getFields().filter((field) => field instanceof SNode);
    }

    walk(cb: (node: SNode) => void): void {
        cb(this);

        for (const child of this.getChildren()) {
            child.walk(cb);
        }
    }

    /**
     * Return the `Range` of this Node. Throw an error if no location exists.
     */
    get requiredRange(): Range {
        assert(this.src !== undefined, "Missing source information for node {0}", this);

        return this.src instanceof Array ? this.src[0] : this.src;
    }

    getSourceFragment(src: Uint8Array): string {
        const rng = this.requiredRange;

        return bytesToString(src.slice(rng.start.offset, rng.end.offset));
    }
}
