import {
    ASTNodeFactory,
    ContractDefinition,
    EventDefinition,
    FunctionDefinition,
    SourceUnit,
    ModifierDefinition,
    StructDefinition,
    EnumDefinition,
    VariableDeclaration,
    ImportDirective,
    ASTNode,
    Expression,
    Statement,
    TypeNode,
    getNodeType
} from "solc-typed-ast";
import { AbsDatastructurePath, assert, dedup, getSetterName, single, specializeSetter } from "..";
import { SUserFunctionDefinition } from "../spec-lang/ast";
import { SemMap, TypeEnv } from "../spec-lang/tc";
import { NameGenerator } from "../util/name_generator";
import { AnnotationMetaData, AnnotationFilterOptions } from "./annotations";
import { CallGraph } from "./callgraph";
import { CHA } from "./cha";
import { generateMapLibrary, getCustomMapLibraryName } from "./custom_maps_templates";
import { InstrumentationSiteType, TranspilingContext } from "./transpiling_context";

/**
 * Gather all named nodes in the provided source units.
 * @param units list of source units
 */
function getAllNames(units: SourceUnit[]): Set<string> {
    const nameSet: Set<string> = new Set();
    for (const unit of units) {
        for (const child of unit.getChildren()) {
            // Add all named declarations
            if (
                child instanceof ContractDefinition ||
                child instanceof FunctionDefinition ||
                child instanceof ModifierDefinition ||
                child instanceof EventDefinition ||
                child instanceof StructDefinition ||
                child instanceof EnumDefinition ||
                child instanceof VariableDeclaration
            ) {
                nameSet.add(child.name);
            }

            if (child instanceof ImportDirective) {
                // Add unit aliases (import "foo" as foo;)
                if (child.unitAlias !== "") {
                    nameSet.add(child.unitAlias);
                }

                // Add all symbol aliases
                for (const [originalDef, alias] of child.vSymbolAliases) {
                    if (alias !== undefined) {
                        nameSet.add(alias);
                    } else {
                        if (!(originalDef instanceof ImportDirective)) {
                            nameSet.add(originalDef.name);
                        }
                    }
                }
            }
        }
    }
    return nameSet;
}

export class InstrumentationContext {
    public readonly nameGenerator: NameGenerator;
    public readonly structVar: string;
    public readonly checkStateInvsFuncName: string;
    public readonly outOfContractFlagName: string;
    public readonly scratchField: string;
    public readonly checkInvsFlag: string;

    public readonly utilsContractName: string;
    private internalInvariantCheckers: Map<ContractDefinition, string> = new Map();
    public readonly userFunctions: Map<SUserFunctionDefinition, FunctionDefinition> = new Map();

    /**
     * Map from Annotations to the list of statements involved in their evaluation.
     */
    public readonly evaluationStatements: Map<AnnotationMetaData, ASTNode[]> = new Map();
    /**
     * Map from Annotations to the actual `Expression` that corresponds to the
     * annotation being fully checked.
     */
    public readonly instrumentedCheck: Map<AnnotationMetaData, Expression[]> = new Map();
    /**
     * Map from Annotations to the actual asserts and event emissions
     * that are hit if the annotation fails.
     */
    public readonly failureCheck: Map<AnnotationMetaData, Statement[]> = new Map();
    /**
     * List of statements added for general instrumentation, not tied to any
     * particular annotation.
     */
    public readonly generalInstrumentationNodes: ASTNode[] = [];

    /**
     * Map containing debug event associated with a given annotation.
     */
    public readonly debugEventsMap: Map<AnnotationMetaData, EventDefinition> = new Map();

    /**
     * Bit of a hack - this is set by `generateUtilsContract`. We need an
     * InstrumentationContext already present for `generateUtilsContract` to be able
     * to use `ctx.nameGenerator`.
     */
    public utilsContract!: ContractDefinition;

    public get utilsUnit(): SourceUnit {
        return this.utilsContract.parent as SourceUnit;
    }

    /**
     * Map keeping track of the `TranspilingContext`s for each `FunctionDefinition`.
     */
    private transCtxMap = new Map<FunctionDefinition, TranspilingContext>();
    /**
     * 2-level Map keeping track of the wrappers functions generated for each contract.
     * The inner map is a mapping from wrapper names to their definition.
     */
    private wrapperCache = new Map<ContractDefinition, Map<string, FunctionDefinition>>();

    private interposingLibraryMap = new Map<string, ContractDefinition>();

    public readonly varInterposingQueue: Array<[VariableDeclaration, AbsDatastructurePath]>;

    constructor(
        public readonly factory: ASTNodeFactory,
        public readonly units: SourceUnit[],
        public readonly assertionMode: "log" | "mstore",
        public readonly addAssert: boolean,
        public readonly callgraph: CallGraph,
        public readonly cha: CHA<ContractDefinition>,
        public readonly filterOptions: AnnotationFilterOptions,
        public readonly annotations: AnnotationMetaData[],
        public readonly wrapperMap: Map<FunctionDefinition, FunctionDefinition>,
        public readonly files: Map<string, string>,
        public readonly compilerVersion: string,
        public readonly debugEvents: boolean,
        public readonly debugEventDefs: Map<number, EventDefinition>,
        public readonly outputMode: "files" | "flat" | "json",
        public readonly typeEnv: TypeEnv,
        public readonly semMap: SemMap,
        _varInterposingQueue: Array<[VariableDeclaration, AbsDatastructurePath]>
    ) {
        this.nameGenerator = new NameGenerator(getAllNames(units));
        this.structVar = this.nameGenerator.getFresh("_v", true);
        this.checkStateInvsFuncName = this.nameGenerator.getFresh(
            "__scribble_check_state_invariants",
            true
        );
        this.outOfContractFlagName = this.nameGenerator.getFresh(
            "__scribble_out_of_contract",
            true
        );

        this.scratchField = this.nameGenerator.getFresh("__mstore_scratch__", true);
        this.checkInvsFlag = this.nameGenerator.getFresh("__scribble_check_invs_at_end", true);
        this.utilsContractName = this.nameGenerator.getFresh("__scribble_ReentrancyUtils", true);
        this.varInterposingQueue = dedup(
            _varInterposingQueue,
            (x: [VariableDeclaration, AbsDatastructurePath]) =>
                `${x[0].name}_${x[1].map((x) => (x === null ? "[]" : x)).join("_")}`
        );
    }

    getWrapper(contract: ContractDefinition, name: string): FunctionDefinition | undefined {
        const m = this.wrapperCache.get(contract);
        if (m === undefined) {
            return undefined;
        }

        return m.get(name);
    }

    setWrapper(contract: ContractDefinition, name: string, wrapper: FunctionDefinition): void {
        let m = this.wrapperCache.get(contract);
        if (m === undefined) {
            m = new Map();
            this.wrapperCache.set(contract, m);
        }

        assert(!m.has(name), `Wrapper ${name} in ${contract.name} already defined.`);
        m.set(name, wrapper);
    }

    getTranspilingCtx(
        container: FunctionDefinition,
        type: InstrumentationSiteType
    ): TranspilingContext {
        if (!this.transCtxMap.has(container)) {
            this.transCtxMap.set(
                container,
                new TranspilingContext(this.typeEnv, this.semMap, container, this, type)
            );
        }

        return this.transCtxMap.get(container) as TranspilingContext;
    }

    getInternalInvariantCheckerName(contract: ContractDefinition): string {
        if (!this.internalInvariantCheckers.has(contract)) {
            this.internalInvariantCheckers.set(
                contract,
                this.nameGenerator.getFresh(
                    `__scribble_${contract.name}_check_state_invariants_internal`,
                    true
                )
            );
        }

        return this.internalInvariantCheckers.get(contract) as string;
    }

    addGeneralInstrumentation(...nodes: ASTNode[]): void {
        this.generalInstrumentationNodes.push(...nodes);
    }

    addAnnotationInstrumentation(annotation: AnnotationMetaData, ...nodes: ASTNode[]): void {
        const targets = this.evaluationStatements.get(annotation);

        if (targets === undefined) {
            this.evaluationStatements.set(annotation, nodes);
        } else {
            targets.push(...nodes);
        }
    }

    addAnnotationCheck(annotation: AnnotationMetaData, pred: Expression): void {
        const targets = this.instrumentedCheck.get(annotation);

        if (targets === undefined) {
            this.instrumentedCheck.set(annotation, [pred]);
        } else {
            targets.push(pred);
        }
    }

    addAnnotationFailureCheck(annotation: AnnotationMetaData, ...nodes: Statement[]): void {
        const targets = this.failureCheck.get(annotation);

        if (targets === undefined) {
            this.failureCheck.set(annotation, nodes);
        } else {
            targets.push(...nodes);
        }
    }

    finalize(): void {
        for (const transCtx of this.transCtxMap.values()) {
            transCtx.finalize();
        }
    }

    private customMapLibrary = new Map<
        string,
        [ContractDefinition, StructDefinition, Map<string, FunctionDefinition>, TypeNode, TypeNode]
    >();

    isCustomMapLibrary(t: ContractDefinition): boolean {
        return this.customMapLibrary.has(t.name);
    }

    getCustomMapLibrary(keyT: TypeNode, valueT: TypeNode): ContractDefinition {
        const name = getCustomMapLibraryName(keyT, valueT);

        let res = this.customMapLibrary.get(name);

        if (!res) {
            const library = generateMapLibrary(
                this,
                keyT,
                valueT,
                this.utilsUnit,
                this.compilerVersion
            );
            const struct = single(library.vStructs);
            const funcs = new Map(library.vFunctions.map((fn) => [fn.name, fn]));
            res = [library, struct, funcs, keyT, valueT];
            this.customMapLibrary.set(name, res);
        }

        return res[0];
    }

    getCustomMapStruct(library: ContractDefinition): StructDefinition {
        const res = this.customMapLibrary.get(library.name);
        assert(res !== undefined, ``);
        return res[1];
    }

    getCustomMapGetter(library: ContractDefinition): FunctionDefinition {
        const res = this.customMapLibrary.get(library.name);
        assert(res !== undefined, ``);
        const getter = res[2].get("get");
        assert(getter !== undefined, ``);

        return getter;
    }

    getCustomMapSetter(library: ContractDefinition, newVal: Expression): FunctionDefinition {
        const res = this.customMapLibrary.get(library.name);
        assert(res !== undefined, ``);
        const [lib, , funs, , valueT] = res;

        const newValT = getNodeType(newVal, this.compilerVersion);
        const setterName = getSetterName(valueT, newValT);
        let setter = funs.get(setterName);

        if (setter === undefined) {
            setter = specializeSetter(this.factory, funs.get("set") as FunctionDefinition, newValT);
            lib.appendChild(setter);
            funs.set(setterName, setter);
        }

        return setter;
    }

    getCustomMapIncDec(
        library: ContractDefinition,
        operator: "++" | "--",
        prefix: boolean
    ): FunctionDefinition {
        const res = this.customMapLibrary.get(library.name);
        assert(res !== undefined, ``);
        const funName = (operator == "++" ? "inc" : "dec") + (prefix ? "_pre" : "");
        const setter = res[2].get(funName);
        assert(setter !== undefined, ``);

        return setter;
    }

    getCustomMapDeleteKey(library: ContractDefinition): FunctionDefinition {
        const res = this.customMapLibrary.get(library.name);
        assert(res !== undefined, ``);
        const setter = res[2].get("deleteKey");
        assert(setter !== undefined, ``);

        return setter;
    }

    setMapInterposingLibrary(
        v: VariableDeclaration,
        path: AbsDatastructurePath,
        lib: ContractDefinition
    ): void {
        const key = `${v.id}_${path.map((x) => (x === null ? `[]` : x)).join("_")}`;
        this.interposingLibraryMap.set(key, lib);
    }

    getMapInterposingLibrary(
        v: VariableDeclaration,
        path: AbsDatastructurePath
    ): ContractDefinition | undefined {
        const key = `${v.id}_${path.map((x) => (x === null ? `[]` : x)).join("_")}`;
        return this.interposingLibraryMap.get(key);
    }
}
