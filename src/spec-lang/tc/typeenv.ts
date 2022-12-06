import { assert, ContractDefinition, InferType, TypeNameType, TypeNode } from "solc-typed-ast";
import { SNode, SUserConstantDefinition, SUserFunctionDefinition } from "../ast";

export type TypeMap = Map<SNode, TypeNode>;

/**
 * Abstract class to map user definitions in Scribble annotations to their scoping areas.
 */
export class UserDefinitionScoping<DefT extends SUserConstantDefinition | SUserFunctionDefinition> {
    readonly mapping: Map<ContractDefinition, Map<string, DefT>> = new Map();

    get(scope: ContractDefinition, name: string): DefT | undefined {
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

    define(scope: ContractDefinition, def: DefT): void {
        let defs = this.mapping.get(scope);

        if (defs === undefined) {
            defs = new Map();
        }

        defs.set(def.name.name, def);

        this.mapping.set(scope, defs);
    }
}

/**
 * Class to map user-defined constants to their scoping areas
 */
export type UserConstantScoping = UserDefinitionScoping<SUserConstantDefinition>;

/**
 * Class to map user-defined functions to their scoping areas
 */
export type UserFunctionScoping = UserDefinitionScoping<SUserFunctionDefinition>;

/**
 * `TypeEnv` holds any typing environment information computed during the
 * typechecking process. We pass an empty `TypeEnv` to `tc(..)` and `tc(...)` passes
 * the type environment between function, accumulating type information as it runs.
 */
export class TypeEnv {
    private mapping: TypeMap;

    readonly userFunctions: UserFunctionScoping;
    readonly userConstants: UserConstantScoping;

    readonly inference: InferType;

    constructor(inference: InferType) {
        this.mapping = new Map();

        this.userFunctions = new UserDefinitionScoping<SUserFunctionDefinition>();
        this.userConstants = new UserDefinitionScoping<SUserConstantDefinition>();

        this.inference = inference;
    }

    get compilerVersion(): string {
        return this.inference.version;
    }

    hasType(node: SNode): boolean {
        return this.mapping.has(node);
    }

    typeOf(node: SNode | TypeNode): TypeNode {
        if (node instanceof TypeNode) {
            return new TypeNameType(node);
        }

        const res = this.mapping.get(node);

        assert(res !== undefined, "Missing type for {0}", node);

        return res;
    }

    define(node: SNode, typ: TypeNode): void {
        this.mapping.set(node, typ);
    }
}
