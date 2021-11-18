import { ContractDefinition, TypeNameType, TypeNode } from "solc-typed-ast";
import { ABIEncoderVersion } from "solc-typed-ast/dist/types/abi";
import { assert } from "../../util";
import { SNode, SUserFunctionDefinition } from "../ast";

export type TypeMap = Map<SNode, TypeNode>;

/**
 * `TypeEnv` holds any typing environment information computed during the
 * typechecking process. We pass an empty `TypeEnv` to `tc(..)` and `tc(...)` passes
 * the type environment between function, accumulating type information as it runs.
 */
export class TypeEnv {
    private typeMap: TypeMap;
    private userFunctions: Map<ContractDefinition, Map<string, SUserFunctionDefinition>>;

    public readonly compilerVersion: string;
    public readonly abiEncoderVersion: ABIEncoderVersion;

    constructor(compilerVersion: string, abiEncoderVersion: ABIEncoderVersion) {
        this.typeMap = new Map();
        this.userFunctions = new Map();

        this.compilerVersion = compilerVersion;
        this.abiEncoderVersion = abiEncoderVersion;
    }

    hasType(node: SNode): boolean {
        return this.typeMap.has(node);
    }

    typeOf(node: SNode | TypeNode): TypeNode {
        if (node instanceof TypeNode) {
            return new TypeNameType(node);
        }

        const res = this.typeMap.get(node);

        assert(res !== undefined, `Missing type for ${node.pp()}`);

        return res;
    }

    define(node: SNode, typ: TypeNode): void {
        this.typeMap.set(node, typ);
    }

    getUserFunction(scope: ContractDefinition, name: string): SUserFunctionDefinition | undefined {
        for (const base of scope.vLinearizedBaseContracts) {
            const funM = this.userFunctions.get(base);

            if (!funM) {
                continue;
            }

            const res = funM.get(name);

            if (res) {
                return res;
            }
        }

        return undefined;
    }

    defineUserFunction(scope: ContractDefinition, fun: SUserFunctionDefinition): void {
        let funM = this.userFunctions.get(scope);

        if (!funM) {
            funM = new Map();
        }

        funM.set(fun.name.name, fun);

        this.userFunctions.set(scope, funM);
    }
}
