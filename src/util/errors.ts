import { Range } from "./location";

export class PPAbleError extends Error {
    readonly range: Range;
    constructor(msg: string, range: Range) {
        super(msg);
        this.range = range;
    }
}
