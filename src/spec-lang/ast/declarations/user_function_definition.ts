import { TypeNode } from "solc-typed-ast";
import { SId } from "../identifier";
import { NodeLocation, SNode } from "../node";
import { AnnotationMD, AnnotationType, SAnnotation } from "./annotation";

export class SUserFunctionDefinition extends SAnnotation {
    public readonly name: SId;
    public readonly parameters: Array<[SId, TypeNode]>;
    public readonly returnType: TypeNode;
    public readonly body: SNode;

    constructor(
        name: SId,
        params: Array<[SId, TypeNode]>,
        returnType: TypeNode,
        body: SNode,
        md?: AnnotationMD,
        src?: NodeLocation
    ) {
        super(AnnotationType.Define, md, src);
        this.name = name;
        this.parameters = params;
        this.returnType = returnType;
        this.body = body;
    }

    getFields(): any[] {
        return [this.name, ...this.parameters.map((x) => x[0]), this.returnType, this.body];
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
