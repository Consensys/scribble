import { Range, SNode } from "../node";
export enum AnnotationType {
    IfSucceeds = "if_succeeds",
    IfUpdated = "if_updated",
    IfAssigned = "if_assigned",
    Invariant = "invariant",
    Define = "define",
    Assert = "assert"
}

export abstract class SAnnotation extends SNode {
    public readonly type: AnnotationType;
    public readonly label?: string;

    prefix: string | undefined;

    constructor(type: AnnotationType, label?: string, src?: Range) {
        super(src);
        this.type = type;
        this.label = label;
    }
}
