import { SPackedArrayType } from "./packed_array_type";

export class SBytes extends SPackedArrayType {
    pp(): string {
        return `bytes`;
    }
}
