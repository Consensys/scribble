import { assert } from "../../util";
import { StructEqualityComparable } from "../../util/struct_equality";

let nNodes = 0;
export type Location = { offset: number; line: number; column: number };
export type Range = { start: Location; end: Location };

// Low-level AST Nodes
export abstract class SNode implements StructEqualityComparable {
    readonly id: number;
    readonly src?: Range;

    constructor(src?: Range) {
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

    get requiredSrc(): Range {
        assert(this.src !== undefined, `Missing source information for node ${this.pp()}`);
        return this.src;
    }

    getSourceFragment(src: string): string {
        const rng = this.requiredSrc;
        return src.slice(rng.start.offset, rng.end.offset);
    }
}
