import { assert, ContractDefinition, SourceUnit, TypeNameType, TypeNode } from "solc-typed-ast";
import { ABIEncoderVersion } from "solc-typed-ast/dist/types/abi";
import { SNode, SUserConstantDefinition, SUserFunctionDefinition } from "../ast";

export type TypeMap = Map<SNode, TypeNode>;

export class UserConstantsScope {
    readonly mapping: Map<SourceUnit, Map<string, SUserConstantDefinition>> = new Map();

    get(scope: SourceUnit, name: string): SUserConstantDefinition | undefined {
        const defs = this.mapping.get(scope);

        if (defs) {
            const def = defs.get(name);

            if (def) {
                return def;
            }
        }

        return undefined;
    }

    define(scope: SourceUnit, def: SUserConstantDefinition): void {
        let defs = this.mapping.get(scope);

        if (defs === undefined) {
            defs = new Map();
        }

        defs.set(def.name.name, def);

        this.mapping.set(scope, defs);
    }

    pp(): string {
        return "<user_constants_scope>";
    }
}

export class UserFunctionsScope {
    readonly mapping: Map<ContractDefinition, Map<string, SUserFunctionDefinition>> = new Map();

    get(scope: ContractDefinition, name: string): SUserFunctionDefinition | undefined {
        for (const base of scope.vLinearizedBaseContracts) {
            const defs = this.mapping.get(base);

            if (defs) {
                const res = defs.get(name);

                if (res) {
                    return res;
                }
            }
        }

        return undefined;
    }

    define(scope: ContractDefinition, def: SUserFunctionDefinition): void {
        let defs = this.mapping.get(scope);

        if (!defs) {
            defs = new Map();
        }

        defs.set(def.name.name, def);

        this.mapping.set(scope, defs);
    }
}

/**
 * `TypeEnv` holds any typing environment information computed during the
 * typechecking process. We pass an empty `TypeEnv` to `tc(..)` and `tc(...)` passes
 * the type environment between function, accumulating type information as it runs.
 */
export class TypeEnv {
    private typeMap: TypeMap;

    /**
     * User-defined functions
     */
    readonly userFunctions: UserFunctionsScope;

    /**
     * User-defined constants
     */
    readonly userConstants: UserConstantsScope;

    readonly compilerVersion: string;
    readonly abiEncoderVersion: ABIEncoderVersion;

    constructor(compilerVersion: string, abiEncoderVersion: ABIEncoderVersion) {
        this.typeMap = new Map();

        this.userFunctions = new UserFunctionsScope();
        this.userConstants = new UserConstantsScope();

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

        assert(res !== undefined, "Missing type for {0}", node);

        return res;
    }

    define(node: SNode, typ: TypeNode): void {
        this.typeMap.set(node, typ);
    }
}
