import { assert } from "solc-typed-ast";
import { AnnotationType } from ".";
import { NodeLocation, SNode } from "../node";
import { AnnotationMD } from "./annotation";
import { DatastructurePath, SStateVarProp } from "./state_var_prop";

/**
 * `SIfUpdated` is a state var property refering to ANY update concerning the
 * state var or a part of it. Currently doesn't support adding a datastructure
 * path due to the not-yet well defined semantics of old() and new values in
 * the cases where a part of a complex data structure is destroyed/created. In
 * those case old/new values may not be defined.
 *
 * Furthremore, in a situation where we have `if_updated[i] ...` for some array
 * `arr` when we reassign/delete the whole array, its not yet defined for which
 * values we call `if_updated arr[i]`. All the old ones? All the new ones? The
 * minimum intersection of old and new?
 *
 */
export class SIfUpdated extends SStateVarProp {
    constructor(expression: SNode, path: DatastructurePath, md?: AnnotationMD, src?: NodeLocation) {
        assert(path.length === 0, "Not yet support if_updated with a path");

        super(AnnotationType.IfUpdated, expression, path, md, src);
    }
}
