import { Range, SNode } from "../node";
import { SType } from "../types";
import { SAnnotation } from "./annotation";

export class SUserFunctionDefinition extends SAnnotation {
    public readonly name: string;
    public readonly parameters: Array<[string, SType]>;
    public readonly returnType: SType;
    public readonly body: SNode;

    constructor(
        name: string,
        params: Array<[string, SType]>,
        returnType: SType,
        body: SNode,
        label?: string,
        src?: Range
    ) {
        super(label, src);
        this.name = name;
        this.parameters = params;
        this.returnType = returnType;
        this.body = body;
    }

    getFields(): any[] {
        return [this.name, this.parameters, this.returnType, this.body];
    }

    pp(): string {
        const paramStr = this.parameters.map(([name, type]) => `${type.pp()} ${name}`).join(", ");
        return `define ${this.label ? `{:msg "${this.label}"} ` : ""}${
            this.name
        }(${paramStr}) ${this.returnType.pp()} = ${this.body.pp()}`;
    }
}
