import { SId } from "../identifier";
import { NodeLocation } from "../node";
import { AnnotationMD, AnnotationType, SAnnotation } from "./annotation";

export class SMacro extends SAnnotation {
    public readonly name: SId;
    public readonly parameters: SId[];

    constructor(name: SId, params: SId[], md?: AnnotationMD, src?: NodeLocation) {
        super(AnnotationType.Macro, md, src);

        this.name = name;
        this.parameters = params;
    }

    getFields(): any[] {
        return [this.name, ...this.parameters];
    }

    pp(): string {
        const paramStr = this.parameters.map((param) => param.pp()).join(", ");

        return `${this.type} ${
            this.label ? `{:msg "${this.label}"} ` : ""
        }${this.name.pp()}(${paramStr})`;
    }
}
