import { AnnotationType } from ".";
import { SNode, Range } from "..";
import { SId } from "../identifier";
import { SProperty } from "./property";

/**
 * `SIfUpdated` is a special kind of property annotation that can also
 * make bindings refereing to datastructure indices
 */
export class SIfUpdated extends SProperty {
    public readonly datastructurePath: Array<SId | string>;

    constructor(expression: SNode, path: Array<SId | string>, label?: string, src?: Range) {
        super(AnnotationType.IfUpdated, expression, label, src);
        this.datastructurePath = path;
    }

    getFields(): any[] {
        return [this.expression, this.datastructurePath, this.label];
    }

    pp(): string {
        const path = this.datastructurePath
            .map((element) => (element instanceof SId ? `[${element.name}]` : `.${element}`))
            .join("");
        return `${this.type}${path} ${
            this.label ? `{:msg "${this.label}"} ` : ""
        }${this.expression.pp()};`;
    }
}
