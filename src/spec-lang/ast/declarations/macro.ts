import { SId } from "../identifier";
import { Range } from "../node";
import { AnnotationType, SAnnotation } from "./annotation";

export class SMacro extends SAnnotation {
    public readonly name: SId;
    public readonly parameters: SId[];

    constructor(name: SId, params: SId[], label?: string, src?: Range) {
        super(AnnotationType.Macro, label, src);

        this.name = name;
        this.parameters = params;
    }

    getFields(): any[] {
        return [this.name, this.parameters];
    }

    pp(): string {
        const paramStr = this.parameters.map((param) => param.pp()).join(", ");

        return `${this.name.pp()}(${paramStr}) ${this.label ? `{:msg "${this.label}"}` : ""}`;
    }
}
