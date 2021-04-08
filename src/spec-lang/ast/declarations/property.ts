import { Range, SNode } from "../node";
import { AnnotationType, SAnnotation } from "./annotation";

export class SProperty extends SAnnotation {
    public readonly expression: SNode;
    constructor(type: AnnotationType, expression: SNode, label?: string, src?: Range) {
        super(type, label, src);
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
