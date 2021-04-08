import { AnnotationType } from ".";
import { SNode, Range } from "..";
import { DatastructurePath, SStateVarProp } from "./state_var_prop";

/**
 * `SIfAssigned` is a state var property checked only at the assignment/deletion of an EXACT
 * part of a state var property, as defined by the provided datastructure path.
 *
 * For example if you have `if_assigned[i] ...` for some array `a`, that property won't get
 * checked if you re-assign the whole array `a = []`.
 *
 */
export class SIfAssigned extends SStateVarProp {
    constructor(expression: SNode, path: DatastructurePath, label?: string, src?: Range) {
        super(AnnotationType.IfAssigned, expression, path, label, src);
    }
}
