import { TypeNode } from "solc-typed-ast";
import { SId } from "../identifier";
import { NodeLocation, SNode } from "../node";
import { AnnotationMD, AnnotationType, SAnnotation } from "./annotation";

export class SUserConstantDefinition extends SAnnotation {
    readonly name: SId;
    readonly formalType: TypeNode;
    readonly value: SNode;

    constructor(
        name: SId,
        formalType: TypeNode,
        value: SNode,
        md?: AnnotationMD,
        src?: NodeLocation
    ) {
        super(AnnotationType.Const, md, src);

        this.name = name;
        this.formalType = formalType;
        this.value = value;
    }

    getFields(): any[] {
        return [this.name, this.formalType, this.value];
    }

    pp(): string {
        return `const ${this.label ? `{:msg "${this.label}"} ` : ""}${this.formalType.pp()} ${
            this.name.name
        } := ${this.value.pp()}`;
    }
}
