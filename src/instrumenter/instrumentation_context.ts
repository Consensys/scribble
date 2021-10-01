import { dirname, relative } from "path";
import {
    ArrayType,
    assert,
    ASTNode,
    ContractDefinition,
    ContractKind,
    DataLocation,
    EnumDefinition,
    EventDefinition,
    Expression,
    FunctionDefinition,
    ImportDirective,
    ModifierDefinition,
    SourceUnit,
    SrcRangeMap,
    Statement,
    StructDefinition,
    TypeNode,
    VariableDeclaration
} from "solc-typed-ast";
import {
    AbsDatastructurePath,
    dedup,
    FactoryMap,
    findAliasedStateVars,
    getSetterName,
    makeArraySumFun,
    makeDeleteFun,
    makeGetFun,
    makeIncDecFun,
    makeSetFun,
    ScribbleFactory,
    StructMap,
    UnsupportedConstruct
} from "..";
import { print } from "../ast_to_source_printer";
import { SUserFunctionDefinition } from "../spec-lang/ast";
import { SemMap, TypeEnv } from "../spec-lang/tc";
import { NameGenerator } from "../util/name_generator";
import { AnnotationFilterOptions, AnnotationMetaData } from "./annotations";
import { CallGraph } from "./callgraph";
import { CHA } from "./cha";
import { generateMapLibrary } from "./custom_maps_templates";
import { DbgIdsMap, InstrumentationSiteType, TranspilingContext } from "./transpiling_context";

/**
 * Gather all named nodes in the provided source units.
 * @param units list of source units
 */
function getAllNames(units: SourceUnit[]): Set<string> {
    const nameSet = new Set<string>();

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

// Helper classes for various caches used in InstrumentationContext
class WrapperCache extends StructMap<[ContractDefinition, string], string, FunctionDefinition> {
    protected getName(contract: ContractDefinition, name: string): string {
        return `${contract.id}_${name}`;
    }
}

abstract class ContextFactoryMap<A extends any[], B extends string | number, C> extends FactoryMap<
    A,
    B,
    C
> {
    constructor(protected ctx: InstrumentationContext) {
        super();
    }
}

class TranspilingContextCache extends ContextFactoryMap<
    [FunctionDefinition, InstrumentationSiteType],
    number,
    TranspilingContext
> {
    protected getName(fun: FunctionDefinition): number {
        return fun.id;
    }

    protected makeNew(fun: FunctionDefinition, type: InstrumentationSiteType): TranspilingContext {
        return new TranspilingContext(this.ctx.typeEnv, this.ctx.semMap, fun, this.ctx, type);
    }
}

class VarToLibraryMap extends StructMap<
    [VariableDeclaration, AbsDatastructurePath],
    string,
    ContractDefinition
> {
    protected getName(v: VariableDeclaration, path: AbsDatastructurePath): string {
        return `${v.id}_${path.map((x) => (x === null ? `[]` : x)).join("_")}`;
    }
}

class TypesToLibraryMap extends ContextFactoryMap<
    [TypeNode, TypeNode],
    string,
    ContractDefinition
> {
    private _inverseMap = new Map<ContractDefinition, [TypeNode, TypeNode]>();

    protected getName(keyT: TypeNode, valueT: TypeNode): string {
        return `${keyT.pp()}_to_${valueT.pp()}`;
    }

    protected makeNew(keyT: TypeNode, valueT: TypeNode): ContractDefinition {
        const res = generateMapLibrary(this.ctx, keyT, valueT, this.ctx.utilsUnit);

        this._inverseMap.set(res, [keyT, valueT]);

        return res;
    }

    public isLib(contract: ContractDefinition): boolean {
        return this._inverseMap.has(contract);
    }

    public getKVTypes(lib: ContractDefinition): [TypeNode, TypeNode] {
        const res = this._inverseMap.get(lib);

        assert(res !== undefined, `Missing key/value types for library ${lib.name}`);

        return res;
    }

    public isCustomMapLibrary(node: ContractDefinition): boolean {
        return this._inverseMap.has(node);
    }
}

class MapGetterMap extends ContextFactoryMap<
    [ContractDefinition, boolean],
    string,
    FunctionDefinition
> {
    protected getName(lib: ContractDefinition, lhs: boolean): string {
        return `${lib.id}_${lhs}`;
    }

    protected makeNew(lib: ContractDefinition, lhs: boolean): FunctionDefinition {
        const [keyT, valueT] = this.ctx.typesToLibraryMap.getKVTypes(lib);

        return makeGetFun(this.ctx, keyT, valueT, lib, lhs);
    }
}

class MapSetterMap extends ContextFactoryMap<
    [ContractDefinition, TypeNode],
    string,
    FunctionDefinition
> {
    protected getName(lib: ContractDefinition, newValT: TypeNode): string {
        const [, valueT] = this.ctx.typesToLibraryMap.getKVTypes(lib);

        return `${lib.id}_${getSetterName(valueT, newValT)}`;
    }
    protected makeNew(lib: ContractDefinition, newValT: TypeNode): FunctionDefinition {
        const [keyT, valueT] = this.ctx.typesToLibraryMap.getKVTypes(lib);

        return makeSetFun(this.ctx, keyT, valueT, lib, newValT);
    }
}

class MapIncDecMap extends ContextFactoryMap<
    [ContractDefinition, "++" | "--", boolean, boolean],
    string,
    FunctionDefinition
> {
    protected getName(
        lib: ContractDefinition,
        operator: "++" | "--",
        prefix: boolean,
        unchecked: boolean
    ): string {
        return `${lib.id}_${operator}_${prefix}_${unchecked}`;
    }

    protected makeNew(
        lib: ContractDefinition,
        operator: "++" | "--",
        prefix: boolean,
        unchecked: boolean
    ): FunctionDefinition {
        const [keyT, valueT] = this.ctx.typesToLibraryMap.getKVTypes(lib);

        return makeIncDecFun(this.ctx, keyT, valueT, lib, operator, prefix, unchecked);
    }
}

class MapDeleteFunMap extends ContextFactoryMap<[ContractDefinition], number, FunctionDefinition> {
    protected getName(lib: ContractDefinition): number {
        return lib.id;
    }

    protected makeNew(lib: ContractDefinition): FunctionDefinition {
        const [keyT, valueT] = this.ctx.typesToLibraryMap.getKVTypes(lib);

        return makeDeleteFun(this.ctx, keyT, valueT, lib);
    }
}

class ArraySumFunMap extends ContextFactoryMap<
    [ArrayType, DataLocation],
    string,
    FunctionDefinition
> {
    protected getName(arrT: ArrayType, loc: DataLocation): string {
        return `${arrT.pp()}_${loc}`;
    }

    protected makeNew(arrT: ArrayType, loc: DataLocation): FunctionDefinition {
        return makeArraySumFun(this.ctx, this.ctx.arrSumLibrary, arrT, loc);
    }
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
    private _generalInstrumentationNodes: ASTNode[] = [];
    public get generalInstrumentationNodes(): ASTNode[] {
        return this._generalInstrumentationNodes;
    }

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

    public readonly varInterposingQueue: Array<[VariableDeclaration, AbsDatastructurePath]>;

    private unitsNeedingUtils = new Set<SourceUnit>();
    private _originalContents: Map<SourceUnit, string>;
    private _aliasedStateVars: Map<VariableDeclaration, ASTNode>;
    /**
     * ContractDefinition for a library containing helper functions for
     * computing sums over arrays. If there are no annotations with sums over
     * arrays, then this is undefined.
     */
    private _arrSumLibrary?: ContractDefinition;

    /**
     * Map keeping track of the `TranspilingContext`s for each `FunctionDefinition`.
     */
    public readonly transCtxMap = new TranspilingContextCache(this);
    /**
     * Cache keeping track of wrappers functions generated for each contract.
     */
    public readonly wrapperCache = new WrapperCache();
    /**
     * Map keeping track of the custom map library generated for a specific state var (or part thereof)
     */
    public readonly sVarToLibraryMap = new VarToLibraryMap();
    /**
     * Map factory keeping track of the custom map library generated for a specific state var (or part thereof)
     */
    public readonly typesToLibraryMap = new TypesToLibraryMap(this);
    /**
     * Map factory keeping track of getter functions generated for a given custom map library
     */
    public readonly libToMapGetterMap = new MapGetterMap(this);
    /**
     * Map factory keeping track of getter functions generated for a given custom map library
     */
    public readonly libToMapSetterMap = new MapSetterMap(this);
    /**
     * Map factory keeping track of increment/decrement functions generated for a given custom map library
     */
    public readonly libToMapIncDecMap = new MapIncDecMap(this);
    /**
     * Map factory keeping track of delete key functions generated for a given custom map library
     */
    public readonly libToDeleteFunMap = new MapDeleteFunMap(this);
    /**
     * Map factory keeping track of array sum functions generated for a given array type and location
     */
    public readonly arraySumFunMap = new ArraySumFunMap(this);

    constructor(
        public readonly factory: ScribbleFactory,
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
        public readonly debugEventsEncoding: Map<number, DbgIdsMap>,
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
                `${x[0].name}_${x[1].map((y) => (y === null ? "[]" : y)).join("_")}`
        );

        this._originalContents = this.printUnits(units, new Map());
        this._aliasedStateVars = findAliasedStateVars(units);
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
        // Finalize all TranspilingContexts
        for (const transCtx of this.transCtxMap.values()) {
            transCtx.finalize();
        }

        // Add imports in all units that need the ReentrancyUtils contract
        for (const unit of this.unitsNeedingUtils) {
            const path = relative(dirname(unit.absolutePath), this.utilsUnit.absolutePath);
            unit.appendChild(
                this.factory.makeImportDirective(
                    `./${path}`,
                    this.utilsUnit.absolutePath,
                    "",
                    [],
                    unit.id,
                    this.utilsUnit.id
                )
            );
        }

        // Finally scan all nodes in generalInsturmentation for any potential orphans, and remove them
        // Orphans can happen during insturmentation, when we replace some node with a re-written copy
        const orphans = new Set<ASTNode>();

        for (const nd of this._generalInstrumentationNodes) {
            if (nd.getClosestParentByType(SourceUnit) === undefined) {
                orphans.add(nd);
            }
        }

        this._generalInstrumentationNodes = this._generalInstrumentationNodes.filter(
            (nd) => !orphans.has(nd)
        );
    }

    /**
     * Mark the given SourceUnit `unit` as needing an import from the utils module in files
     * instrumentation mode.
     */
    needsUtils(unit: SourceUnit): void {
        this.unitsNeedingUtils.add(unit);
    }

    /**
     * Return the list of SourceUnits that were changed by instrumentation.
     * @todo We currently compute this by printing the files before and after
     * and comparing the contents. This is simple, but inefficient. It would be better
     * to either diff the ASTs themselves, or to keep a generation counter somewhere inside
     * the AST.
     */
    get changedUnits(): SourceUnit[] {
        const newContents = this.printUnits(this.units, new Map());
        const res: SourceUnit[] = [];

        for (const [unit, newUnitCont] of newContents.entries()) {
            const oldUnitCont = this._originalContents.get(unit);

            if (oldUnitCont !== newUnitCont) {
                res.push(unit);
            }
        }

        return res;
    }

    getAliasingNode(v: VariableDeclaration): ASTNode | undefined {
        return this._aliasedStateVars.get(v);
    }

    crashIfAliased(varDef: VariableDeclaration): void {
        const potentialAliasing = this.getAliasingNode(varDef);

        if (potentialAliasing !== undefined) {
            throw new UnsupportedConstruct(
                `Cannot instrument state var ${(varDef.parent as ContractDefinition).name}.${
                    varDef.name
                } as it may be aliased by a storage pointer`,
                potentialAliasing,
                this.files
            );
        }
    }

    printUnits(units: SourceUnit[], srcMap: SrcRangeMap): Map<SourceUnit, string> {
        return print(units, this.compilerVersion, srcMap);
    }

    get arrSumLibrary(): ContractDefinition {
        if (this._arrSumLibrary === undefined) {
            const utilsUnit = this.utilsUnit;

            this._arrSumLibrary = this.factory.makeContractDefinition(
                "arr_sum_funs",
                utilsUnit.id,
                ContractKind.Library,
                false,
                true,
                [],
                []
            );

            this.utilsUnit.appendChild(this._arrSumLibrary);
        }

        return this._arrSumLibrary;
    }
}
