import { SType } from "./type";
import { Range } from "../node";

export class SAddressType extends SType {
    payable: boolean;

    constructor(payable: boolean, src?: Range) {
        super(src);
        this.payable = payable;
    }

    pp(): string {
        return `address${this.payable ? " payable" : ""}`;
    }

    getFields(): any[] {
        return [this.payable];
    }
}
