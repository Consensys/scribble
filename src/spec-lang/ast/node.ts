import { assert, PPAble, StructEqualityComparable } from "solc-typed-ast";
import { Range } from "../../util/location";

let nNodes = 0;
// Node location
export type InstantiatedMacroLoc = [Range, Range];
export type NodeLocation = Range | InstantiatedMacroLoc;

export function isMacroLoc(loc: NodeLocation): loc is InstantiatedMacroLoc {
    return loc instanceof Array;
}

// Low-level AST Nodes
export abstract class SNode implements StructEqualityComparable, PPAble {
    readonly id: number;
    readonly src?: NodeLocation;

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
     * Return the `NodeLocation` of this Node. Throw an error if no location exists
     */
    get requiredSrc(): NodeLocation {
        assert(this.src !== undefined, "Missing source information for node {0}", this);

        return this.src;
    }

    /**
     * Return the `Range` of this Node. Throw an error if no location exists.
     * This works the same as `requiredSrc`, except in the case when this is an annotation
     * instantiated from a macro. In this case instead of the location (which is a pair of ranges)
     * it returns just the range corrseponding to the node in the yaml file.
     */
    get requiredRange(): Range {
        assert(this.src !== undefined, "Missing source information for node {0}", this);

        return this.src instanceof Array ? this.src[0] : this.src;
    }

    getSourceFragment(src: string): string {
        const rng = this.requiredRange;

        return src.slice(rng.start.offset, rng.end.offset);
    }
}
