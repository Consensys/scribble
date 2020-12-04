import { SReferenceType } from "./reference_type";
import { Range } from "../node";

export abstract class SPackedArrayType extends SReferenceType {
    constructor(src?: Range) {
        super(src);
    }

    getFields(): any[] {
        return [];
    }
}
