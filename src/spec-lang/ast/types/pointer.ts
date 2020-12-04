import { SType } from "./type";
import { DataLocation } from "solc-typed-ast";
import { Range } from "../node";

export class SPointer extends SType {
    to: SType;
    location: DataLocation;

    constructor(to: SType, location: DataLocation, src?: Range) {
        super(src);
        this.to = to;
        this.location = location;
    }

    pp(): string {
        return `${this.to.pp()} ${this.location} *`;
    }

    getFields(): any[] {
        return [this.to, this.location];
    }
}
