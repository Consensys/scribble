import { NodeLocation, SNode } from "../node";
import { AnnotationMD, AnnotationType, SAnnotation } from "./annotation";

export class SProperty extends SAnnotation {
    public readonly expression: SNode;
    constructor(type: AnnotationType, expression: SNode, md?: AnnotationMD, src?: NodeLocation) {
        super(type, md, src);
        this.expression = expression;
    }

    getFields(): any[] {
        return [this.type, this.expression, this.label];
    }

    pp(): string {
        return `${this.type} ${
            this.label ? `{:msg "${this.label}"} ` : ""
        }${this.expression.pp()};`;
    }
}
