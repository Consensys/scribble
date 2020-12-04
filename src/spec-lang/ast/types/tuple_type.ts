import { SType } from "./type";
import { Range } from "../node";

export class STupleType extends SType {
    public readonly elements: SType[];
    constructor(elements: SType[], src?: Range) {
        super(src);
        this.elements = elements;
    }

    pp(): string {
        return `(${this.elements.map((element) => element.pp()).join(",")})`;
    }

    getFields(): any[] {
        return [this.elements];
    }
}
