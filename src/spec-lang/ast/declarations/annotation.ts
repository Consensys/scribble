import { Range, SNode } from "../node";

export abstract class SAnnotation extends SNode {
    public readonly label?: string;
    constructor(label?: string, src?: Range) {
        super(src);
        this.label = label;
    }
}
