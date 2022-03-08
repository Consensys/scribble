import { SId } from "..";
import { NodeLocation, SNode } from "../node";
import { AnnotationMD, AnnotationType, SAnnotation } from "./annotation";

export class SLetAnnotation extends SAnnotation {
    public readonly name: SId;
    public readonly expression: SNode;

    constructor(
        type: AnnotationType,
        name: SId,
        expression: SNode,
        md?: AnnotationMD,
        src?: NodeLocation
    ) {
        super(type, md, src);
        this.name = name;
        this.expression = expression;
    }

    getFields(): any[] {
        return [this.type, this.expression, this.label];
    }

    pp(): string {
        return `${this.type} ${
            this.label ? `{:msg "${this.label}"} ` : ""
        } ${this.name.pp()} := ${this.expression.pp()};`;
    }
}
