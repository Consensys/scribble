import { Range, SNode } from "../node";
import { SAnnotation } from "./annotation";

export enum PropertyType {
    IfSucceeds = "if_succeeds",
    IfAborts = "if_aborts",
    Invariant = "invariant"
}

export class SProperty extends SAnnotation {
    public readonly type: PropertyType;
    public readonly expression: SNode;
    constructor(type: PropertyType, expression: SNode, label?: string, src?: Range) {
        super(label, src);
        this.type = type;
        this.expression = expression;
    }

    getFields(): any[] {
        return [this.expression, this.label];
    }

    pp(): string {
        return `${this.type} ${
            this.label ? `{:msg "${this.label}"} ` : ""
        }${this.expression.pp()};`;
    }
}
