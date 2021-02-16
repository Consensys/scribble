import {
    ASTNodeFactory,
    ContractDefinition,
    DataLocation,
    FunctionDefinition,
    FunctionVisibility,
    Mutability,
    StateVariableVisibility,
    StructDefinition,
    TypeName,
    VariableDeclaration
} from "solc-typed-ast";
import { SId, SLet, SUnaryOperation, SUserFunctionDefinition } from "../spec-lang/ast";
import { SemMap, TypeMap } from "../spec-lang/tc";
import { assert } from "../util";
import { InstrumentationContext } from "./instrumentation_context";

/**
 * Class containing all the context necessary to transpile
 * a group of spec expression into Solidity code.
 *
 * This class is responsible for ensuring that there are no collisions in the
 * binding names generated while transpiling the expressions.
 */
export class TranspilingContext {
    private static firstInstance = true;
    private bindingMap: Map<string, string> = new Map();
    public readonly scratchField = "__mstore_scratch__";
    public readonly checkInvsFlag = "__scribble_check_invs_at_end";
    public readonly bindingsStructDef: StructDefinition;
    public readonly bindingsVar: VariableDeclaration;
    public readonly factory: ASTNodeFactory;

    constructor(
        public readonly typing: TypeMap,
        public readonly semInfo: SemMap,
        public readonly container: FunctionDefinition,
        public readonly instrCtx: InstrumentationContext
    ) {
        this.factory = instrCtx.factory;

        // Create the StructDefinition for temporary bindings.
        const contract = this.container.vScope;
        assert(
            contract instanceof ContractDefinition,
            `Can't put instrumentation into free functions.`
        );

        const structName = instrCtx.nameGenerator.getFresh("vars");
        const canonicalStructName = `${contract.name}.${structName}`;
        this.bindingsStructDef = this.factory.makeStructDefinition(
            structName,
            canonicalStructName,
            contract.id,
            FunctionVisibility.Private,
            []
        );

        // Create the local struct variable where the temporary bindigngs live
        this.bindingsVar = this.factory.makeVariableDeclaration(
            false,
            false,
            instrCtx.structVar,
            this.container.id,
            false,
            DataLocation.Memory,
            StateVariableVisibility.Default,
            Mutability.Mutable,
            "<missing>",
            undefined,
            this.factory.makeUserDefinedTypeName("<missing>", structName, this.bindingsStructDef.id)
        );

        // Make sure that on the first run we reserve this.scratchField and this.checkInvsFlag as field names.
        if (TranspilingContext.firstInstance) {
            TranspilingContext.firstInstance = false;
            this.instrCtx.nameGenerator.getFresh(this.scratchField, true);
            this.instrCtx.nameGenerator.getFresh(this.checkInvsFlag, true);
        }
    }

    /**
     * Get the binding name for a particular let binding identifier. E.g. in this code:
     * ```
     *      let x : = 1 in let x := true in x ? 0 : 1;
     * ```
     *
     * For the first `x` `getLetBinding` will return `x` and for the second it will return `x1`.
     * @param arg
     */
    getLetBinding(arg: SId | [SLet, number]): string {
        const [letDecl, idx] = arg instanceof SId ? (arg.defSite as [SLet, number]) : arg;
        const key = `<let_${letDecl.id}_${idx}>`;
        if (!this.bindingMap.has(key)) {
            let name = arg instanceof SId ? arg.name : arg[0].lhs[idx].name;
            if (name === "_") {
                name = "dummy_";
            }
            const fieldName = this.instrCtx.nameGenerator.getFresh(name, true);
            this.bindingMap.set(key, fieldName);
        }

        return this.bindingMap.get(key) as string;
    }

    getUserFunArg(userFun: SUserFunctionDefinition, idx: number): string {
        const key = `<uf_arg_${userFun.id}_${idx}>`;
        if (!this.bindingMap.has(key)) {
            const name = userFun.parameters[idx][0].name;
            const uniqueName = this.instrCtx.nameGenerator.getFresh(name, true);
            this.bindingMap.set(key, uniqueName);
        }

        return this.bindingMap.get(key) as string;
    }

    /**
     * Get temporary var used to store the result of a let expression. E.g. for this expression:
     *
     * ```
     *      let x : = 1 in x + x >= 2;
     * ```
     *
     * getLetVar(..) will generate a temporary variable `let_1` that stores the result of the whole expression (true in this case.)
     *
     * @param arg
     */
    getLetVar(node: SLet): string {
        const key = `<let_${node.id}>`;
        assert(!this.bindingMap.has(key), `getLetVar called more than once for ${node.pp()}`);
        const res = this.instrCtx.nameGenerator.getFresh("let_");
        this.bindingMap.set(key, res);
        return res;
    }

    /**
     * Get temporary var used to store the result of an old expression. E.g. for this expression:
     *
     * ```
     *      old(x > 1)
     * ```
     *
     * getOldVar(..) will generate a temporary variable `old_1` that stores the result of the whole expression before the function call.
     *
     * @param arg
     */
    getOldVar(node: SUnaryOperation): string {
        const key = `<old_${node.id}>`;
        assert(!this.bindingMap.has(key), `getOldVar called more than once for ${node.pp()}`);
        const res = this.instrCtx.nameGenerator.getFresh("old_");
        this.bindingMap.set(key, res);
        return res;
    }

    addBinding(name: string, type: TypeName): VariableDeclaration {
        const decl = this.factory.makeVariableDeclaration(
            false,
            false,
            name,
            this.bindingsStructDef.id,
            false,
            DataLocation.Default,
            StateVariableVisibility.Default,
            Mutability.Mutable,
            "<missing>",
            undefined,
            type
        );

        this.bindingsStructDef.appendChild(decl);
        return decl;
    }
}
