import { SType } from "./type";
import { Range } from "..";

export class SFixedBytes extends SType {
    size: number;

    constructor(size: number, src?: Range) {
        super(src);
        this.size = size;
    }

    pp(): string {
        return `bytes${this.size}`;
    }

    getFields(): any[] {
        return [this.size];
    }
}
