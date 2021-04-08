// Need the ts-nocheck to suppress the noUnusedLocals errors in the generated parser
// @ts-nocheck
import bigInt from "big-integer";
import {
    SId,
    SNode,
    SNumber,
    SBoolType,
    SAddressType,
    SIntType,
    SFixedBytes,
    SBytes,
    SPointer,
    SString,
    SArrayType,
    SMemberAccess,
    SUserDefinedType,
    SMappingType,
    SFunctionType,
    STupleType,
    SIntLiteralType,
    SStringLiteralType
} from "./ast";
import { DataLocation, FunctionVisibility, FunctionStateMutability } from "solc-typed-ast";

function getFunctionAttributes(
    rawDecorators: string[]
): [FunctionVisibility, FunctionStateMutability] {
    let visiblity: FunctionVisibility | undefined;
    let mutability: FunctionStateMutability | undefined;

    for (const decorator of rawDecorators) {
        if (["external", "internal"].includes(decorator)) {
            if (visiblity !== undefined) {
                throw new Error(
                    `Multiple visiblity decorators specified: ${decorator} conflicts with ${visiblity}`
                );
            }
            visiblity = decorator;
        }
        if (["pure", "view", "nonpayable", "payable"].includes(decorator)) {
            if (mutability !== undefined) {
                throw new Error(
                    `Multiple mutability decorators specified: ${decorator} conflicts with ${mutability}`
                );
            }
            mutability = decorator;
        }
    }

    // Assume default visiblity is internal
    if (visiblity === undefined) {
        visiblity = FunctionVisibility.Internal;
    }

    // Assume default mutability is non-payable
    if (mutability === undefined) {
        mutability = FunctionStateMutability.NonPayable;
    }

    return [visiblity, mutability];
}
