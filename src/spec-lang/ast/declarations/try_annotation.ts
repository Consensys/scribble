import { AnnotationType } from ".";
import { NodeLocation, SNode } from "../node";
import { AnnotationMD, SAnnotation } from "./annotation";

/**
 * `STryAnnotation` is a special kind of property annotation
 * that is able to accept several expressions.
 */
export class STryAnnotation extends SAnnotation {
    readonly exprs: SNode[];

    constructor(type: AnnotationType, exprs: SNode[], md?: AnnotationMD, src?: NodeLocation) {
        super(type, md, src);

        this.exprs = exprs;
    }

    getFields(): any[] {
        return [this.type, ...this.exprs, this.label];
    }

    pp(): string {
        const args = this.exprs.map((arg) => arg.pp()).join(", ");

        return `${this.type} ${this.label ? `{:msg "${this.label}"} ` : ""}${args};`;
    }
}
