import { SPackedArrayType } from "./packed_array_type";

export class SString extends SPackedArrayType {
    pp(): string {
        return `string`;
    }
}
