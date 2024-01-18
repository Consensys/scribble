import {
    ArrayType,
    assert,
    ASTNode,
    ContractDefinition,
    DataLocation,
    EnumDefinition,
    EventDefinition,
    Expression,
    stringToBytes,
    FunctionCallKind,
    FunctionDefinition,
    ImportDirective,
    InferType,
    Literal,
    MemberAccess,
    ModifierDefinition,
    NamedDefinition,
    resolveAny,
    SourceUnit,
    SrcRangeMap,
    Statement,
    StructDefinition,
    bytesToString,
    TypeNode,
    VariableDeclaration
} from "solc-typed-ast";
import { print } from "../ast_to_source_printer";
import {
    ScribbleBuiltinFunctions,
    SId,
    SUserConstantDefinition,
    SUserFunctionDefinition
} from "../spec-lang/ast";
import { SemMap, TypeEnv } from "../spec-lang/tc";
import { dedup, getOrInit } from "../util/misc";
import { NameGenerator } from "../util/name_generator";
import { SourceMap } from "../util/sources";
import { AnnotationFilterOptions, AnnotationMetaData } from "./annotations";
import { CallGraph } from "./callgraph";
import { CHA } from "./cha";
import { AbsDatastructurePath } from "./custom_maps";
import {
    generateMapLibrary,
    getSetterName,
    makeDeleteFun,
    makeGetFun,
    makeIncDecFun,
    makeSetFun
} from "./custom_maps_templates";
import { makeArraySumFun, UnsupportedConstruct } from "./instrument";
import { findAliasedStateVars } from "./state_vars";
import { InstrumentationSiteType, TranspilingContext } from "./transpiling_context";
import { FactoryMap, ScribbleFactory, StructMap } from "./utils";
import { generateUtilsLibrary, makeEqBytesFun } from "./utils_library";

export type AssertionMode = "log" | "mstore" | "hardhat";

const utf8enc = new TextEncoder();

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
        const res = new TranspilingContext(this.ctx.typeEnv, this.ctx.semMap, fun, this.ctx, type);

        if (type === InstrumentationSiteType.SinglePointWrapper) {
            res.initSinglePointWrapper();
        } else if (type === InstrumentationSiteType.TwoPointWrapper) {
            res.initTwoPointWrapper();
        } else {
            assert(
                type === InstrumentationSiteType.Custom,
                `Unexpected instrumentation site type ${type}`
            );
        }
        return res;
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
    [TypeNode, TypeNode, SourceUnit],
    string,
    ContractDefinition
> {
    private _inverseMap = new Map<ContractDefinition, [TypeNode, TypeNode]>();

    protected getName(keyT: TypeNode, valueT: TypeNode, unit: SourceUnit): string {
        return `${keyT.pp()}_to_${valueT.pp()}_${unit.id}`;
    }

    protected makeNew(keyT: TypeNode, valueT: TypeNode, unit: SourceUnit): ContractDefinition {
        const res = generateMapLibrary(this.ctx, keyT, valueT, unit);

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
    [ArrayType, DataLocation, SourceUnit],
    string,
    FunctionDefinition
> {
    protected getName(arrT: ArrayType, loc: DataLocation, file: SourceUnit): string {
        return `${arrT.pp()}_${loc}_${file.id}`;
    }

    protected makeNew(arrT: ArrayType, loc: DataLocation, file: SourceUnit): FunctionDefinition {
        return this.ctx.getArrSumFun(file, arrT, loc);
    }
}

class UtilsLibraryMap extends ContextFactoryMap<[SourceUnit], string, ContractDefinition> {
    inverseMap = new Map<ContractDefinition, SourceUnit>();

    protected getName(unit: SourceUnit): string {
        return `__ScribbleUtilsLib__${unit.id}`;
    }

    protected makeNew(unit: SourceUnit): ContractDefinition {
        const res = generateUtilsLibrary(unit, this.ctx);

        this.inverseMap.set(res, unit);

        return res;
    }

    isUtilsLibrary(contract: ContractDefinition): boolean {
        return this.inverseMap.has(contract);
    }
}

export class InstrumentationContext {
    public readonly nameGenerator: NameGenerator;
    public readonly structVar: string;
    public readonly checkStateInvsFuncName: string;
    public readonly scratchField: string;
    public readonly checkInvsFlag: string;

    private internalInvariantCheckers: Map<ContractDefinition, string> = new Map();
    public readonly userFunctions: Map<SUserFunctionDefinition, FunctionDefinition> = new Map();
    public readonly userConstants: Map<SUserConstantDefinition, VariableDeclaration> = new Map();

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
    public readonly failureStatements: Map<AnnotationMetaData, Statement[]> = new Map();
    /**
     * List of statements added for general instrumentation, not tied to any
     * particular annotation.
     */
    private _generalInstrumentationNodes: ASTNode[] = [];
    public get generalInstrumentationNodes(): ASTNode[] {
        return this._generalInstrumentationNodes;
    }

    /**
     * Map from an annotation to an array describing the arguments to the debug
     * event emitted for this annotation.
     */
    public readonly debugEventsDescMap: Map<AnnotationMetaData, Array<[SId[], TypeNode]>> =
        new Map();

    public readonly varInterposingQueue: Array<[VariableDeclaration, AbsDatastructurePath]>;

    private _originalContents: Map<SourceUnit, string>;
    private _aliasedStateVars: Map<VariableDeclaration, ASTNode>;

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

    private readonly utilsLibraryMap = new UtilsLibraryMap(this);

    private readonly litAdjustMap = new Map<Literal, ASTNode>();

    private readonly unitsNeedsImports = new Map<SourceUnit, Set<string>>();

    /**
     * A map from units to the sets of definitions they need imported due to instrumentation
     */
    private readonly unitNeedsDefs = new Map<SourceUnit, Set<NamedDefinition>>();

    constructor(
        public readonly factory: ScribbleFactory,
        public readonly units: SourceUnit[],
        public readonly assertionMode: AssertionMode,
        public readonly covAssertions: boolean,
        public readonly addAssert: boolean,
        public readonly callgraph: CallGraph,
        public readonly cha: CHA<ContractDefinition>,
        public readonly filterOptions: AnnotationFilterOptions,
        public readonly annotations: AnnotationMetaData[],
        public readonly wrapperMap: Map<FunctionDefinition, FunctionDefinition>,
        public readonly files: SourceMap,
        public readonly compilerVersion: string,
        public readonly debugEvents: boolean,
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

        this.scratchField = this.nameGenerator.getFresh("__mstore_scratch__", true);
        this.checkInvsFlag = this.nameGenerator.getFresh("__scribble_check_invs_at_end", true);

        this.varInterposingQueue = dedup(
            _varInterposingQueue,
            (x: [VariableDeclaration, AbsDatastructurePath]) =>
                `${x[0].name}_${x[1].map((y) => (y === null ? "[]" : y)).join("_")}`
        );

        this._originalContents = this.printUnits(units, new Map());
        this._aliasedStateVars = findAliasedStateVars(units);
    }

    isScribbleGeneratedContract(contract: ContractDefinition): boolean {
        return (
            this.typesToLibraryMap.isCustomMapLibrary(contract) ||
            this.utilsLibraryMap.isUtilsLibrary(contract)
        );
    }

    getResolvedPath(arg: SourceUnit | string): string {
        const absPath = arg instanceof SourceUnit ? arg.absolutePath : arg;
        const srcFile = this.files.get(absPath);
        assert(srcFile !== undefined, `Missing SourceFile for unit ${absPath}`);
        return srcFile.fileName;
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
        const targets = this.failureStatements.get(annotation);

        if (targets === undefined) {
            this.failureStatements.set(annotation, nodes);
        } else {
            targets.push(...nodes);
        }
    }

    addStringLiteralToAdjust(lit: Literal, loc: ASTNode): void {
        this.litAdjustMap.set(lit, loc);
    }

    adjustStringLiterals(
        contents: string,
        unit: SourceUnit,
        fileInd: number,
        srcMap: SrcRangeMap
    ): string {
        const replaceMarker = "000000:0000:000";
        const byteContents = stringToBytes(contents);

        for (const [lit, targetNode] of this.litAdjustMap) {
            if (lit.getClosestParentByType(SourceUnit) !== unit) {
                continue;
            }

            const newLoc = srcMap.get(targetNode);
            const strLoc = srcMap.get(lit);

            assert(newLoc !== undefined, `Missing loc for {0}`, targetNode);
            assert(strLoc !== undefined, `Missing loc for {0}`, lit);

            const startAt = strLoc[0];
            const endAt = strLoc[0] + strLoc[1];

            let litStr = bytesToString(byteContents.slice(startAt, endAt));

            assert(
                litStr.startsWith("'") || litStr.startsWith('"') || litStr.startsWith("unicode"),
                `Expected {0} (at {1}) to have a string start at the beginning`,
                litStr,
                startAt
            );

            assert(
                litStr.includes(replaceMarker),
                "Expected {0} to contain {1}",
                litStr,
                replaceMarker
            );

            const newLocStr = `${String(newLoc[0]).padStart(6, "0")}:${String(newLoc[1]).padStart(
                4,
                "0"
            )}:${String(fileInd).padStart(3, "0")}`;

            litStr = litStr.replace(replaceMarker, newLocStr);

            utf8enc.encodeInto(litStr, byteContents.subarray(startAt));
        }

        return bytesToString(byteContents);
    }

    needsImport(unit: SourceUnit, importPath: string): void {
        const importPaths = getOrInit(unit, this.unitsNeedsImports, new Set());

        importPaths.add(importPath);
    }

    needsDefinition(unit: SourceUnit, def: NamedDefinition): void {
        const defs = getOrInit(unit, this.unitNeedsDefs, new Set());

        defs.add(def);
    }

    finalize(): void {
        // Finalize all TranspilingContexts
        for (const transCtx of this.transCtxMap.values()) {
            transCtx.finalize();
        }

        const infer = new InferType(this.compilerVersion);
        for (const [unit, neededDefs] of this.unitNeedsDefs) {
            for (const def of neededDefs) {
                const resolvedDef = resolveAny(def.name, unit, infer, true);
                const defUnit = def.getClosestParentByType(SourceUnit);

                if (resolvedDef.size === 0 && defUnit) {
                    this.needsImport(unit, defUnit.sourceEntryKey);
                }
            }
        }

        for (const [unit, importPaths] of this.unitsNeedsImports) {
            for (const importPath of importPaths) {
                const importDirective = this.factory.makeImportDirective(
                    importPath,
                    importPath,
                    "",
                    [],
                    unit.id,
                    /**
                     * A hack to make directive to refer to existing source unit.
                     * Otherwise, AST-to-source writer would crash due to inability to check for exported symbols.
                     */
                    unit.id
                );

                /**
                 * Mark import directive as "created by Scribble"
                 * to preserve during flattening or during import rewrites.
                 */
                importDirective.raw = "$scribble_utility$";

                unit.appendChild(importDirective);

                this.addGeneralInstrumentation(importDirective);
            }
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

    private getUtilsLib(ctx: ASTNode): ContractDefinition {
        const file = ctx instanceof SourceUnit ? ctx : ctx.getClosestParentByType(SourceUnit);

        assert(file !== undefined, "Unable to detect source unit for node {0}", ctx);

        return this.utilsLibraryMap.get(file);
    }

    private getUtilsLibFun(ctx: ASTNode, name: string): MemberAccess {
        const lib = this.getUtilsLib(ctx);
        const funDef = lib.vFunctions.find((fn) => fn.name === name);

        assert(funDef !== undefined, 'Unable to find definition of utility function "{0}"', name);

        return this.factory.makeMemberAccess(
            "<missing>",
            this.factory.makeIdentifierFor(lib),
            name,
            funDef.id
        );
    }

    private getUtilsLibEvent(ctx: ASTNode, name: string): MemberAccess {
        const lib = this.getUtilsLib(ctx);
        const evtDef = lib.vEvents.find((evt) => evt.name === name);

        assert(evtDef !== undefined, 'Unable to find definition of utility event "{0}"', name);

        return this.factory.makeMemberAccess(
            "<missing>",
            this.factory.makeIdentifierFor(lib),
            name,
            evtDef.id
        );
    }

    getAssertionFailedFun(ctx: ASTNode): MemberAccess {
        return this.getUtilsLibFun(ctx, "assertionFailed");
    }

    getAssertionFailedDataFun(ctx: ASTNode): MemberAccess {
        return this.getUtilsLibFun(ctx, "assertionFailedData");
    }

    getAssertionFailedEvent(ctx: ASTNode): MemberAccess {
        return this.getUtilsLibEvent(ctx, "AssertionFailed");
    }

    getAssertionFailedDataEvent(ctx: ASTNode): MemberAccess {
        return this.getUtilsLibEvent(ctx, "AssertionFailedData");
    }

    getBuiltinFun(ctx: ASTNode, name: string): MemberAccess {
        const allowed = new Set<string>(Object.values(ScribbleBuiltinFunctions));

        assert(allowed.has(name), 'Unsupported builtin "{0}"', name);

        const lib = this.getUtilsLib(ctx);

        let funDef = lib.vFunctions.find((fn) => fn.name === name);

        if (funDef === undefined) {
            if (name === ScribbleBuiltinFunctions.eq_encoded) {
                funDef = makeEqBytesFun(lib, this);
            } else {
                throw new Error(`Unable to compose builtin function "${name}"`);
            }

            lib.appendChild(funDef);
        }

        return this.factory.makeMemberAccess(
            "<missing>",
            this.factory.makeIdentifierFor(lib),
            name,
            funDef.id
        );
    }

    getArrSumFun(file: SourceUnit, arrT: ArrayType, loc: DataLocation): FunctionDefinition {
        const utilsLib = this.utilsLibraryMap.get(file);

        return makeArraySumFun(this, utilsLib, arrT, loc);
    }

    setInContract(ctx: ASTNode, val: Expression): Expression {
        const factory = this.factory;

        return factory.makeFunctionCall(
            "<missing>",
            FunctionCallKind.FunctionCall,
            this.getUtilsLibFun(ctx, "setInContract"),
            [val]
        );
    }

    isInContract(ctx: ASTNode): Expression {
        const factory = this.factory;
        return factory.makeFunctionCall(
            "bool",
            FunctionCallKind.FunctionCall,
            this.getUtilsLibFun(ctx, "isInContract"),
            []
        );
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

    printUnits(
        units: SourceUnit[],
        srcMap: SrcRangeMap,
        instrumentationMarker?: string
    ): Map<SourceUnit, string> {
        return print(units, this.compilerVersion, srcMap, instrumentationMarker);
    }
}
