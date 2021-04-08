import {
    ASTNodeFactory,
    Block,
    ContractDefinition,
    DataLocation,
    Expression,
    FunctionDefinition,
    FunctionVisibility,
    MemberAccess,
    Mutability,
    StateVariableVisibility,
    StructDefinition,
    TypeName,
    VariableDeclaration
} from "solc-typed-ast";
import { SId, SLet, SUnaryOperation, SUserFunctionDefinition } from "../spec-lang/ast";
import { SemMap, TypeEnv } from "../spec-lang/tc";
import { assert } from "../util";
import { InstrumentationContext } from "./instrumentation_context";
import { makeTypeString } from "./type_string";

/**
 * Class containing all the context necessary to transpile
 * a group of spec expression into Solidity code.
 *
 * This class is responsible for ensuring that there are no collisions in the
 * binding names generated while transpiling the expressions.
 */
export class TranspilingContext {
    /**
     * Map from 'binding keys' to the actual temporary binding names. 'binding keys' uniquely identify
     * the location where a given temporary is generated. We use this 2-level mapping to avoid name collisions
     */
    private bindingMap: Map<string, string> = new Map();
    /**
     * Map from a binding name to the corresponding `VariableDeclaration` for the member field for this binding.
     */
    private bindingDefMap: Map<string, VariableDeclaration> = new Map();
    /**
     * A ref-counter for how many times the temporary bindings struct and temporary bindings var have been used.
     * As on optimization we only emit those in `finalize()` only if `varRefc > 0`.
     */
    private varRefc = 0;
    /**
     * A struct definition containing any temporary values used in the compilation of this context
     */
    private bindingsStructDef: StructDefinition;
    /**
     * The declaration of a local var of type `this.bindingsStructDef` used for temporary values.
     */
    private bindingsVar: VariableDeclaration;

    public get factory(): ASTNodeFactory {
        return this.instrCtx.factory;
    }

    constructor(
        public readonly typeEnv: TypeEnv,
        public readonly semInfo: SemMap,
        public readonly container: FunctionDefinition,
        public readonly instrCtx: InstrumentationContext
    ) {
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

        const bindingsVarType = this.factory.makeUserDefinedTypeName(
            "<missing>",
            structName,
            this.bindingsStructDef.id
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
            makeTypeString(bindingsVarType, DataLocation.Memory),
            undefined,
            bindingsVarType
        );
    }

    /**
     * When interposing on tuple assignments we generate temporary variables for components of the lhs of the tuple. E.g. for:
     *
     * ```
     *     (x, (a.y, z[1])) = ....
     * ```
     *
     * We would generate:
     *
     * ```
     *     (_v.tmp1, (_v.tmp2, _v.tmp3)) = ....
     *     z[1] = _v.tmp3;
     *     a.y = _v.tmp2;
     *     x = _v.tmp1;
     * ```
     *
     * This is used for state var update interposing.
     */
    getTupleAssignmentBinding(tupleComp: Expression): string {
        const key = `tuple_temp_${tupleComp.id}`;
        if (!this.bindingMap.has(key)) {
            const fieldName = this.instrCtx.nameGenerator.getFresh(`tuple_tmp_`);
            this.bindingMap.set(key, fieldName);
            return fieldName;
        }

        return this.bindingMap.get(key) as string;
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

    /**
     * Add a new binding named `name` with type `type` to the temporary struct.
     */
    addBinding(name: string, type: TypeName): VariableDeclaration {
        assert(!this.bindingDefMap.has(name), `Binding ${name} already defined.`);

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

        this.bindingDefMap.set(name, decl);
        this.bindingsStructDef.appendChild(decl);
        return decl;
    }

    /**
     * Return an ASTNode (MemberAccess) referring to a particular binding.
     */
    refBinding(name: string): MemberAccess {
        const member = this.bindingDefMap.get(name);
        assert(member !== undefined, `No temp binding ${name} defined`);

        this.varRefc++;
        return this.factory.makeMemberAccess(
            makeTypeString(member.vType as TypeName, DataLocation.Memory),
            this.factory.makeIdentifierFor(this.bindingsVar),
            name,
            member.id
        );
    }

    /**
     * Return an `SId` refering to the temporary bindings local var. (set defSite accordingly)
     */
    getBindingVarSId(): SId {
        const res = new SId(this.bindingsVar.name);
        res.defSite = this.bindingsVar;
        this.varRefc++;
        return res;
    }

    /**
     * Finalize this context. Currently adds the temporaries StructDef and local var if they are neccessary
     */
    finalize(): void {
        if (this.varRefc == 0) {
            return;
        }

        const contract = this.container.parent;
        assert(contract instanceof ContractDefinition, ``);
        contract.appendChild(this.bindingsStructDef);
        const block = this.container.vBody as Block;
        const localVarStmt = this.factory.makeVariableDeclarationStatement([], [this.bindingsVar]);

        this.instrCtx.addGeneralInstrumentation(localVarStmt);
        block.insertBefore(localVarStmt, block.children[0]);
    }
}
