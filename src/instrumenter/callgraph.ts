import {
    ContractDefinition,
    FunctionCall,
    FunctionDefinition,
    resolveCallable,
    SourceUnit
} from "solc-typed-ast";
import { getOr, single } from "../util";

export type FunSet = Set<FunctionDefinition>;
export type FunMap = Map<FunctionDefinition, FunSet>;
export interface CallGraph {
    /**
     * Map from a FunctionDefinition to the set of function definitions that call it.
     */
    callers: FunMap;
    /**
     * Map from a FunctionDefinition to the set of function definitions it calls.
     */
    callees: FunMap;
    /**
     * Map from a FunctionDefinition to the set of function definitions that it
     * directly overrides. (So if f overrides g, and g overrides h, then
     * overrides[f] = {g} and overrides[g] = {h})
     */
    overrides: FunMap;
    /**
     * Map from a FunctionDefinition to the set of function definitions that
     * override it directly. (So if f overrides g, and g overrides h, then
     * overridenBy[h] = {g} and overridenBy[g] = {f})
     */
    overridenBy: FunMap;
}

export function getCallGraph(srcs: SourceUnit[]): CallGraph {
    const callers: FunMap = new Map();
    const callees: FunMap = new Map();

    const overrides: FunMap = new Map();
    const overridenBy: FunMap = new Map();

    // Initialize the maps
    for (const file of srcs) {
        for (const fun of file.vFunctions) {
            callers.set(fun, new Set());
            callees.set(fun, new Set());
            overrides.set(fun, new Set());
            overridenBy.set(fun, new Set());
        }

        for (const contract of file.vContracts) {
            for (const fun of contract.vFunctions) {
                callers.set(fun, new Set());
                callees.set(fun, new Set());
                overrides.set(fun, new Set());
                overridenBy.set(fun, new Set());
            }
        }
    }

    for (const file of srcs) {
        for (const fun of file.vFunctions) {
            for (const call of fun.getChildrenByType(FunctionCall)) {
                const called = call.vReferencedDeclaration;

                if (!(called instanceof FunctionDefinition)) {
                    continue;
                }

                getOr(callers, called).add(fun);
                getOr(callees, fun).add(called);
            }
        }

        for (const contract of file.vContracts) {
            for (const fun of contract.vFunctions) {
                const overrideSet: FunSet = new Set();

                // First fill out `overrides` and `overridenBy`
                if (
                    fun.vOverrideSpecifier !== undefined &&
                    fun.vOverrideSpecifier.vOverrides.length > 0
                ) {
                    fun.vOverrideSpecifier.vOverrides.forEach((contractT) => {
                        const contract = contractT.vReferencedDeclaration as ContractDefinition;
                        const overridenFun = single(
                            contract.vFunctions.filter(
                                (fd) => fd.canonicalSignature === fun.canonicalSignature
                            )
                        );
                        overrideSet.add(overridenFun);
                    });
                } else {
                    const overridenFun = resolveCallable(contract, fun, true) as FunctionDefinition;

                    if (overridenFun !== undefined) {
                        overrideSet.add(overridenFun);
                    }
                }

                for (const overridenFun of overrideSet) {
                    getOr(overrides, fun).add(overridenFun);
                    getOr(overridenBy, overridenFun).add(fun);
                }

                // Next fill out `callers` and `callees`
                for (const call of fun.getChildrenByType(FunctionCall)) {
                    const called = call.vReferencedDeclaration;

                    if (!(called instanceof FunctionDefinition)) {
                        continue;
                    }

                    getOr(callers, called).add(fun);
                    getOr(callees, fun).add(called);
                }
            }
        }
    }

    return { callers, callees, overrides, overridenBy };
}
