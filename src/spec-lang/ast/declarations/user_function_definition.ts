import { SId } from "../identifier";
import { Range, SNode } from "../node";
import { SType } from "../types";
import { AnnotationType, SAnnotation } from "./annotation";

export class SUserFunctionDefinition extends SAnnotation {
    public readonly name: SId;
    public readonly parameters: Array<[SId, SType]>;
    public readonly returnType: SType;
    public readonly body: SNode;

    constructor(
        name: SId,
        params: Array<[SId, SType]>,
        returnType: SType,
        body: SNode,
        label?: string,
        src?: Range
    ) {
        super(AnnotationType.Define, label, src);
        this.name = name;
        this.parameters = params;
        this.returnType = returnType;
        this.body = body;
    }

    getFields(): any[] {
        return [this.name, this.parameters, this.returnType, this.body];
    }

    pp(): string {
        const paramStr = this.parameters
            .map(([name, type]) => `${type.pp()} ${name.name}`)
            .join(", ");
        return `define ${this.label ? `{:msg "${this.label}"} ` : ""}${
            this.name.name
        }(${paramStr}) ${this.returnType.pp()} = ${this.body.pp()}`;
    }
}
