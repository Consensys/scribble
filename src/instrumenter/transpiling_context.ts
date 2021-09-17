import { gte } from "semver";
import {
    ASTNode,
    Block,
    ContractDefinition,
    DataLocation,
    Expression,
    FunctionDefinition,
    FunctionVisibility,
    MemberAccess,
    Mutability,
    Statement,
    StateVariableVisibility,
    StructDefinition,
    TypeName,
    TypeNode,
    UncheckedBlock,
    VariableDeclaration
} from "solc-typed-ast";
import { AnnotationMetaData, pp, ScribbleFactory } from "..";
import {
    SForAll,
    SId,
    SLet,
    SUnaryOperation,
    SUserFunctionDefinition,
    VarDefSite
} from "../spec-lang/ast";
import { SemMap, StateVarScope, TypeEnv } from "../spec-lang/tc";
import { assert, last } from "../util";
import { InstrumentationContext } from "./instrumentation_context";
import { makeTypeString } from "./type_string";
import { FactoryMap, StructMap } from "./utils";

export enum InstrumentationSiteType {
    FunctionAnnotation,
    ContractInvariant,
    UserDefinedFunction,
    StateVarUpdated,
    Assert
}

export type ASTMap = Map<ASTNode, ASTNode>;

type PositionInBlock = "start" | "end" | ["after", Statement] | ["before", Statement];
type Marker = [Block, PositionInBlock];

export function defSiteToKey(defSite: VarDefSite): string {
    if (defSite instanceof VariableDeclaration) {
        return `${defSite.id}`;
    }

    if (defSite instanceof Array && defSite[0] instanceof SLet) {
        return `let_${defSite[0].id}_${defSite[1]}`;
    }

    if (defSite instanceof Array && defSite[0] instanceof StateVarScope) {
        return `svar_path_binding_${defSite[0].annotation.id}_${defSite[1]}`;
    }

    if (defSite instanceof SForAll) {
        return `forall_${defSite.id}`;
    }

    throw new Error(`NYI debug info for def site ${pp(defSite)}`);
}

export class DbgIdsMap extends StructMap<[VarDefSite], string, [SId[], Expression, TypeNode]> {
    protected getName(id: VarDefSite): string {
        return defSiteToKey(id);
    }
}

class AnnotationDebugMap extends FactoryMap<[AnnotationMetaData], number, DbgIdsMap> {
    protected getName(md: AnnotationMetaData): number {
        return md.parsedAnnot.id;
    }

    protected makeNew(): DbgIdsMap {
        return new DbgIdsMap();
    }
}

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
    /**
     * Positions where 'old' statements are inserted. This is a stack to support building expressions with nested scopes
     */
    private oldMarkerStack?: Marker[];
    /**
     * Positions where statements outside of an `old` context are inserted. This is a stack to support building expressions with nested scopes
     */
    private newMarkerStack!: Marker[];

    public get factory(): ScribbleFactory {
        return this.instrCtx.factory;
    }

    /**
     * Keep track of any UncheckedBlocks inserted by the context, so that we can prune out the empty ones in `finalize()`
     */
    private uncheckedBlocks: UncheckedBlock[] = [];

    /**
     * Current annotation being transpiled. Note this can change through the lifetime of a single TranspilingContext object.
     */
    public curAnnotation!: AnnotationMetaData;

    public readonly contract: ContractDefinition;

    public readonly dbgInfo = new AnnotationDebugMap();

    public get containerContract(): ContractDefinition {
        const fun = this.containerFun;
        assert(fun.vScope instanceof ContractDefinition, `Unexpected free function ${fun.name}`);
        return fun.vScope;
    }

    constructor(
        public readonly typeEnv: TypeEnv,
        public readonly semInfo: SemMap,
        public readonly containerFun: FunctionDefinition,
        public readonly instrCtx: InstrumentationContext,
        public readonly instrSiteType: InstrumentationSiteType
    ) {
        // Create the StructDefinition for temporary bindings.
        const contract = this.containerFun.vScope;
        assert(
            contract instanceof ContractDefinition,
            `Can't put instrumentation into free functions.`
        );

        this.contract = contract;
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
            this.containerFun.id,
            false,
            DataLocation.Memory,
            StateVariableVisibility.Default,
            Mutability.Mutable,
            makeTypeString(bindingsVarType, DataLocation.Memory),
            undefined,
            bindingsVarType
        );

        if (gte(instrCtx.compilerVersion, "0.8.0")) {
            const containerBody = this.containerFun.vBody as Block;
            if (
                this.instrSiteType === InstrumentationSiteType.FunctionAnnotation ||
                this.instrSiteType === InstrumentationSiteType.StateVarUpdated
            ) {
                const uncheckedBlock = this.factory.makeUncheckedBlock([]);
                this.uncheckedBlocks.push(uncheckedBlock);
                containerBody.insertAtBeginning(uncheckedBlock);

                this.oldMarkerStack = [[uncheckedBlock, "end"]];
            }

            const newUncheckedBlock = this.factory.makeUncheckedBlock([]);
            this.uncheckedBlocks.push(newUncheckedBlock);
            containerBody.appendChild(newUncheckedBlock);
            this.newMarkerStack = [[newUncheckedBlock, "end"]];
        } else {
            const containerBody = this.containerFun.vBody as Block;
            if (
                this.instrSiteType === InstrumentationSiteType.FunctionAnnotation ||
                this.instrSiteType === InstrumentationSiteType.StateVarUpdated
            ) {
                const firstStmt = containerBody.vStatements[0];

                this.oldMarkerStack = [[containerBody, ["before", firstStmt]]];
            }

            this.newMarkerStack = [[containerBody, "end"]];
        }

        if (instrCtx.assertionMode === "mstore") {
            this.addBinding(
                instrCtx.scratchField,
                this.factory.makeElementaryTypeName("<missing>", "uint256")
            );
        }
    }

    private _insertStatement(stmt: Statement, position: Marker): void {
        const [block, posInBlock] = position;

        if (posInBlock === "start") {
            block.insertAtBeginning(stmt);
        } else if (posInBlock === "end") {
            block.appendChild(stmt);
        } else if (posInBlock[0] === "before") {
            block.insertBefore(stmt, posInBlock[1]);
        } else if (posInBlock[0] === "after") {
            block.insertAfter(stmt, posInBlock[1]);
        } else {
            throw new Error(`Unknown position ${posInBlock}`);
        }
    }

    private getMarkerStack(isOld: boolean): Marker[] {
        if (isOld) {
            if (this.oldMarkerStack === undefined) {
                throw new Error(
                    `InternalError: cannot insert statement in the old context of ${this.containerFun.name}. Not support for instrumentation site.`
                );
            }

            return this.oldMarkerStack;
        } else {
            return this.newMarkerStack;
        }
    }

    insertStatement(arg: Statement | Expression, isOld: boolean, addToCurAnnotation = false): void {
        if (arg instanceof Expression) {
            arg = this.factory.makeExpressionStatement(arg);
        }
        this._insertStatement(arg, last(this.getMarkerStack(isOld)));

        if (addToCurAnnotation) {
            this.instrCtx.addAnnotationInstrumentation(this.curAnnotation, arg);
        }
    }

    insertAssignment(
        lhs: Expression,
        rhs: Expression,
        isOld: boolean,
        addToCurAnnotation = false
    ): Statement {
        const assignment = this.factory.makeAssignment("<missing>", "=", lhs, rhs);
        const stmt = this.factory.makeExpressionStatement(assignment);
        this.insertStatement(stmt, isOld, addToCurAnnotation);
        return stmt;
    }

    pushMarker(marker: Marker, isOld: boolean): void {
        this.getMarkerStack(isOld).push(marker);
    }

    popMarker(isOld: boolean): void {
        const stack = this.getMarkerStack(isOld);
        assert(stack.length > 1, `Popping bottom marker - shouldn't happen`);
        stack.pop();
    }

    /**
     * Reset a marker stack to a new starting position. This is used for transpiling assertions, as we share one
     * TranspilingContext for the whole function.
     *
     * @TODO this is a hack. Find a cleaner way to separate the responsibilities between holding function-wide information and
     * specific annotation instance information during transpiling.
     */
    resetMarkser(marker: Marker, isOld: boolean): void {
        if (isOld) {
            this.oldMarkerStack = [marker];
        } else {
            this.newMarkerStack = [marker];
        }
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
     */
    getOldVar(node: SUnaryOperation): string {
        const key = `<old_${node.id}>`;
        assert(!this.bindingMap.has(key), `getOldVar called more than once for ${node.pp()}`);
        const res = this.instrCtx.nameGenerator.getFresh("old_");
        this.bindingMap.set(key, res);
        return res;
    }

    /**
     * Get temporary var used to store the result of a forall expression. E.g. for this expression:
     *
     * ```
     *      forall (uint t in a) a[t] > 10
     * ```
     *
     * getForAllVar(..) will generate a temporary variable `forall_1` that stores the result of the ForAll expression and is
     * updated on every iteration
     */
    getForAllVar(node: SForAll): string {
        const key = `<forall_${node.id}>`;
        assert(!this.bindingMap.has(key), `getForAllVar called more than once for ${node.pp()}`);
        const res = this.instrCtx.nameGenerator.getFresh("forall_");
        this.bindingMap.set(key, res);
        return res;
    }

    /**
     * Get temporary var used to store iterator variable of a forall expression. E.g. for this expression:
     *
     * ```
     *      forall (uint t in a) a[t] > 10
     * ```
     *
     * getForAllVar(..) will generate a temporary variable `t_1` that stores the value of t across every iteration.
     */
    getForAllIterVar(node: SForAll): string {
        const key = `<forall_${node.id}_iter>`;
        let res: string | undefined = this.bindingMap.get(key);

        if (res === undefined) {
            res = this.instrCtx.nameGenerator.getFresh(node.iteratorVariable.name);
            this.bindingMap.set(key, res);
        }

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
        // Prune out empty unchecked blocks
        for (const block of this.uncheckedBlocks) {
            if (block.vStatements.length === 0) {
                const container = block.parent;
                assert(container instanceof Block || container instanceof UncheckedBlock, ``);
                container.removeChild(block);
            }
        }

        // Insert the temporaries struct def and local var (if neccessary)
        if (this.varRefc == 0) {
            return;
        }

        this.containerContract.appendChild(this.bindingsStructDef);

        const block = this.containerFun.vBody as Block;
        const localVarStmt = this.factory.makeVariableDeclarationStatement([], [this.bindingsVar]);

        this.instrCtx.addGeneralInstrumentation(localVarStmt);

        block.insertBefore(localVarStmt, block.children[0]);
    }

    /**
     * Get temporary var used to store the value of an id inside an old expression for debugging purposes. E.g. for this expression:
     */
    getDbgVar(node: SId): string {
        const key = `<dbg ${defSiteToKey(node.defSite as VarDefSite)}>`;
        assert(!this.bindingMap.has(key), `getOldVar called more than once for ${node.pp()}`);
        const res = this.instrCtx.nameGenerator.getFresh("dbg_");
        this.bindingMap.set(key, res);
        return res;
    }
}
