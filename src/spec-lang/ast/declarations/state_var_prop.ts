import { AnnotationType } from ".";
import { SId } from "../identifier";
import { NodeLocation, SNode } from "../node";
import { AnnotationMD } from "./annotation";
import { SProperty } from "./property";

/**
 * A path inside of a complex data structure. The `SId` components correspond to indexing inside of an array/map. The
 * `string` components correspond to field lookups inside structs.
 */
export type DatastructurePath = Array<SId | string>;
/**
 * `SIfUpdated` is a special kind of property annotation that can also
 * make bindings refering to datastructure indices
 */
export class SStateVarProp extends SProperty {
    public readonly datastructurePath: DatastructurePath;

    constructor(
        annotationType: AnnotationType,
        expression: SNode,
        path: DatastructurePath,
        md?: AnnotationMD,
        src?: NodeLocation
    ) {
        super(annotationType, expression, md, src);
        this.datastructurePath = path;
    }

    getFields(): any[] {
        return [this.type, this.expression, ...this.datastructurePath, this.label];
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
