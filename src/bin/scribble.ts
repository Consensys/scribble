#!/usr/bin/env node
import fse from "fs-extra";
import path, { dirname, relative } from "path";
import {
    ASTContext,
    ASTNode,
    ASTNodeFactory,
    ASTReader,
    CompileFailedError,
    compileJson,
    compileJsonData,
    CompileResult,
    compileSol,
    compileSourceString,
    ContractDefinition,
    ContractKind,
    EnumDefinition,
    ExternalReferenceType,
    FunctionDefinition,
    FunctionKind,
    Identifier,
    SourceUnit,
    StructDefinition,
    UserDefinedTypeName,
    VariableDeclaration
} from "solc-typed-ast";
import { print, rewriteImports } from "../ast_to_source_printer";
import {
    Annotation,
    AnnotationExtractor,
    SyntaxError,
    UnsupportedByTargetError
} from "../instrumenter/annotations";
import { getCallGraph } from "../instrumenter/callgraph";
import { CHA, chaDFS, getCHA } from "../instrumenter/cha";
import {
    AnnotationFilterOptions,
    ContractInstrumenter,
    FunctionInstrumenter,
    generateUtilsContract,
    InstrumentationContext
} from "../instrumenter/instrument";
import { merge } from "../rewriter/merge";
import { isSane } from "../rewriter/sanity";
import { Location, Range, SBoolType, SType } from "../spec-lang/ast";
import {
    sc,
    SemError,
    SemInfo,
    SemMap,
    STypeError,
    STypingCtx,
    tc,
    TypeMap
} from "../spec-lang/tc";
import {
    assert,
    getOrInit,
    getScopeUnit,
    isChangingState,
    isExternallyVisible,
    single,
    ContractInvariantsData
} from "../util";
import cli from "./scribble_cli.json";

const commandLineArgs = require("command-line-args");
const commandLineUsage = require("command-line-usage");

function error(msg: string): never {
    console.error(msg);

    process.exit(1);
}

function prettyError(
    type: string,
    message: string,
    unit: SourceUnit,
    location: Range | Location,
    annotation: string
): never {
    const coords =
        "line" in location
            ? `${location.line}:${location.column}`
            : `${location.start.line}:${location.start.column}`;

    const description = [
        `${unit.absolutePath}:${coords} ${type}: ${message}`,
        "In:",
        annotation
    ].join("\n\n");

    error(description);
}

function getAnnotationsOrDie(
    node: ContractDefinition | FunctionDefinition,
    sources: Map<string, string>,
    filters: AnnotationFilterOptions
): Annotation[] {
    try {
        const extractor = new AnnotationExtractor();
        const annotations = extractor.extract(node, sources, filters);

        return annotations;
    } catch (e) {
        if (e instanceof SyntaxError || e instanceof UnsupportedByTargetError) {
            const unit = getScopeUnit(node);

            prettyError(e.constructor.name, e.message, unit, e.range.start, e.annotation);
        }

        throw e;
    }
}

function tcOrDie(
    annotation: Annotation,
    ctx: STypingCtx,
    typing: TypeMap,
    semInfo: SemMap,
    fn: FunctionDefinition | undefined,
    contract: ContractDefinition,
    source: string
): [SType, SemInfo] {
    let type: SType;
    let semantics: SemInfo;

    const unit = contract.vScope;
    const expr = annotation.expression;

    try {
        type = tc(expr, ctx, typing);
        semantics = sc(expr, { isOld: false }, typing, semInfo);
    } catch (err) {
        const scope = fn === undefined ? `${contract.name}` : `${contract.name}.${fn.name}`;

        if (err instanceof STypeError || err instanceof SemError) {
            const loc = err.loc();
            const fileLoc = annotation.predOffToFileLoc([loc.start.offset, loc.end.offset], source);

            prettyError("TypeError", err.message, unit, fileLoc, annotation.original);
        } else {
            error(`Internal error in type-checking ${expr.pp()} of ${scope}: ${err.message}`);
        }
    }

    if (type instanceof SBoolType) {
        return [type, semantics];
    }

    prettyError(
        "TypeError",
        `expected annotation of type bool not ${type.pp()}`,
        unit,
        annotation.predicateFileLoc(source),
        annotation.original
    );
}

function compile(
    fileName: string,
    type: "source" | "json",
    compilerVersion: string,
    remapping: string[]
): CompileResult {
    if (fileName === "--") {
        const content = fse.readFileSync(0, { encoding: "utf-8" });

        fileName = "stdin";

        return type === "json"
            ? compileJsonData(fileName, JSON.parse(content), compilerVersion, remapping)
            : compileSourceString(fileName, content, compilerVersion, remapping);
    }

    if (!fileName || !fse.existsSync(fileName)) {
        throw new Error("Path not found");
    }

    const stats = fse.statSync(fileName);

    if (!stats.isFile()) {
        throw new Error("Target is not a file");
    }

    return type === "json"
        ? compileJson(fileName, compilerVersion, remapping)
        : compileSol(fileName, compilerVersion, remapping);
}

function computeContractInvs(
    cha: CHA<ContractDefinition>,
    filterOptions: AnnotationFilterOptions,
    files: Map<string, string>,
    contractAnnotMap: Map<ContractDefinition, Annotation[]>
): void {
    // Note: Can't use standard chaDFS as we use args/returns here more specially
    chaDFS(cha, (contract: ContractDefinition): void => {
        if (contractAnnotMap.has(contract)) {
            return;
        }

        const annotations = getAnnotationsOrDie(contract, files, filterOptions);

        if (annotations.length > 0) {
            contractAnnotMap.set(contract, annotations);
        }
    });
}

/**
 * Not all contracts in the CHA need to have contract-wide invariants instrumentation.
 *
 * If we consider the CHA to consist of disjoint DAGs, then a contract needs contract-invariant
 * instrumentation IFF at least one contract in it's DAG has contract invariant annotations.
 *
 * @param cha - contract inheritance hierarchy
 * @param contractAnnotMap - map with extracted contract annotations
 */
function computeContractsNeedingInstr(
    cha: CHA<ContractDefinition>,
    contractAnnotMap: Map<ContractDefinition, Annotation[]>
): Set<ContractDefinition> {
    // Find the contracts needing instrumentaion by doing bfs starting from the annotated contracts
    const wave = [...contractAnnotMap.keys()];
    const visited = new Set<ContractDefinition>();

    while (wave.length > 0) {
        const cur = wave.pop() as ContractDefinition;

        if (visited.has(cur)) continue;
        visited.add(cur);

        for (const parent of cha.parents.get(cur) as ContractDefinition[]) {
            if (!visited.has(parent)) wave.push(parent);
        }

        for (const child of cha.children.get(cur) as Set<ContractDefinition>) {
            if (!visited.has(child)) wave.push(child);
        }
    }

    return visited;
}

function instrumentFiles(
    ctx: InstrumentationContext,
    contractInvMap: Map<ContractDefinition, Annotation[]>,
    contractsNeedingInstr: Set<ContractDefinition>
): [SourceUnit[], SourceUnit[]] {
    const units = ctx.units;
    const filters = ctx.filterOptions;

    const worklist: Array<[ContractDefinition, FunctionDefinition | undefined, Annotation[]]> = [];
    const typing: TypeMap = new Map();
    const semInfo: SemMap = new Map();
    const changedSourceUnits: SourceUnit[] = [];

    for (const unit of units) {
        let changed = false;

        const contents = ctx.files.get(unit.sourceEntryKey);

        assert(contents !== undefined, `Missing source for ${unit.absolutePath}`);

        for (const fun of unit.vFunctions) {
            /**
             * We call `getAnnotationsOrDie()` here to make sure there are no annotations on free functions.
             */
            getAnnotationsOrDie(fun, ctx.files, filters);
        }

        for (const contract of unit.vContracts) {
            const typeCtx: STypingCtx = [units, contract];

            let contractAnnot = contractInvMap.get(contract);

            if (contractAnnot === undefined) {
                contractAnnot = [];
            }

            for (const annot of contractAnnot) {
                tcOrDie(annot, typeCtx, typing, semInfo, undefined, contract, contents);
            }

            const needsContrInstr = contractsNeedingInstr.has(contract);

            // Nothing to instrument on interfaces
            if (contract.kind === ContractKind.Interface) {
                continue;
            }

            if (needsContrInstr) {
                worklist.push([contract, undefined, contractAnnot]);
                ctx.annotations.push(...contractAnnot);
                changed = true;
                assert(
                    ![ContractKind.Library, ContractKind.Interface].includes(contract.kind),
                    `Shouldn't be instrumenting ${contract.kind} ${contract.name} with contract invs`
                );
            }

            for (const fun of contract.vFunctions) {
                // Skip functions without a body
                if (fun.vBody === undefined) {
                    continue;
                }

                const typeCtx: STypingCtx = [units, contract, fun];
                const annotations = getAnnotationsOrDie(fun, ctx.files, filters);

                for (const annot of annotations) {
                    tcOrDie(annot, typeCtx, typing, semInfo, fun, contract, contents);
                }

                /**
                 * We interpose on functions if either of these is true
                 *  a) They have annotations
                 *  b) They are external or public AND they modify state (not constant/pure/view) AND they are not the constructor AND they are not fallback/receive
                 *
                 * Note: Constructors are instrumented in instrumentContract, not by instrumentFunction. fallback() and receive() don't check state invariants.
                 */
                if (
                    annotations.length > 0 ||
                    (needsContrInstr &&
                        isExternallyVisible(fun) &&
                        isChangingState(fun) &&
                        contract.kind === ContractKind.Contract &&
                        fun.kind === FunctionKind.Function)
                ) {
                    changed = true;

                    worklist.push([contract, fun, annotations]);
                    ctx.annotations.push(...annotations);
                }
            }
        }

        if (changed) {
            changedSourceUnits.push(unit);
        }
    }

    const contractInstrumenter = new ContractInstrumenter();
    const functionInstrumenter = new FunctionInstrumenter();
    const instrumentedInvariantData: Map<string, ContractInvariantsData> = new Map();
    for (const [contract, fn, annotations] of worklist) {
        if (fn === undefined) {
            contractInstrumenter.instrument(
                ctx,
                typing,
                semInfo,
                annotations,
                contract,
                instrumentedInvariantData
            );
        } else {
            functionInstrumenter.instrument(
                ctx,
                typing,
                semInfo,
                annotations,
                contract,
                fn,
                contractsNeedingInstr.has(contract)
            );
        }
    }

    return [units, changedSourceUnits];
}

function printUnits(all: SourceUnit[], version: Map<SourceUnit, string>): Map<SourceUnit, string> {
    return print(all, version);
}

type TopLevelDef = ContractDefinition | StructDefinition | EnumDefinition;

/**
 * When flattening units, we may introduce two definitions with the same name.
 * Rename definitions accordingly.
 *
 * @param units - units to flatten
 */
function fixNameConflicts(units: SourceUnit[]): void {
    const nameMap = new Map<string, TopLevelDef[]>();

    for (const unit of units) {
        unit.vContracts.forEach((contr) => getOrInit(contr.name, nameMap, []).push(contr));
        unit.vStructs.forEach((struct) => getOrInit(struct.name, nameMap, []).push(struct));
        unit.vEnums.forEach((enumDef) => getOrInit(enumDef.name, nameMap, []).push(enumDef));
    }

    for (const [, defs] of nameMap) {
        // Rename all defs after the first one
        for (let defIdx = 1; defIdx < defs.length; defIdx++) {
            const def = defs[defIdx];

            def.name += `_${defIdx}`;
        }
    }
}

function getTypeScope(n: ASTNode): SourceUnit | ContractDefinition {
    const typeScope = n.getClosestParentBySelector(
        (p: ASTNode) => p instanceof SourceUnit || p instanceof ContractDefinition
    ) as SourceUnit | ContractDefinition;
    return typeScope;
}

function getFQName(
    def: ContractDefinition | FunctionDefinition | StructDefinition | EnumDefinition,
    atUseSite: ASTNode
): string {
    if (def instanceof ContractDefinition) {
        return def.name;
    }

    const scope = def.vScope;

    if (scope instanceof SourceUnit) {
        return def.name;
    } else {
        if (def instanceof FunctionDefinition && getTypeScope(def) === getTypeScope(atUseSite)) {
            return def.name;
        }

        return scope.name + "." + def.name;
    }
}

/**
 * When flattening units, sometimes we can break Identifier/UserDefinedType names. There are
 * 2 general cases:
 *  - An Identifier/UserDefinedType referes to an `import {a as b} ...`
 *  - An Identifier/UserDefinedType refers to a top-level definition that was renamed to avoid a name conflict.
 * @param units - units to flatten
 */
function fixRenamingErrors(units: SourceUnit[]): void {
    for (const unit of units) {
        for (const child of unit.getChildrenBySelector(
            (node) => node instanceof Identifier || node instanceof UserDefinedTypeName
        )) {
            const namedNode = child as Identifier | UserDefinedTypeName;
            const def = namedNode.vReferencedDeclaration;

            if (
                child instanceof Identifier &&
                child.vIdentifierType !== ExternalReferenceType.UserDefined
            ) {
                continue;
            }

            if (
                !(
                    def instanceof ContractDefinition ||
                    def instanceof StructDefinition ||
                    def instanceof EnumDefinition ||
                    def instanceof FunctionDefinition
                )
            ) {
                continue;
            }

            const fqDefName = getFQName(def, namedNode);

            if (fqDefName !== namedNode.name) {
                namedNode.name = fqDefName;
            }
        }
    }
}

const params = cli as any;

let options = params[1].optionList;

for (const option of options) {
    option.type = (global as any)[option.type];
}

try {
    options = commandLineArgs(params[1].optionList);
} catch (e) {
    console.log(e.message);

    process.exit(1);
}

function oneOf(input: any, options: string[], msg: string): any {
    if (!options.includes(input)) {
        error(msg);
    }

    return input;
}

/**
 * Sort the passed in source-units in topological order of their imports.
 *
 * @param units list of source-units to sort
 */
function topoSort(units: SourceUnit[]): SourceUnit[] {
    // Map from a source unit A, to the set of source units that import A
    const importersM = new Map<SourceUnit, Set<SourceUnit>>();
    // Map from a source unit A, to the number of different source units that A imports
    const nImportsM = new Map<SourceUnit, number>();
    // Map from absolute paths to source units
    const pathMap = new Map(units.map((unit) => [unit.absolutePath, unit]));

    for (const unit of units) {
        const importees: Set<SourceUnit> = new Set();

        for (const imp of unit.vImportDirectives) {
            const importee = pathMap.get(imp.vSourceUnit.absolutePath);
            assert(importee !== undefined, ``);
            importees.add(importee);

            const importers = getOrInit(importee, importersM, new Set());

            importers.add(unit);

            importersM.set(imp.vSourceUnit, importers);
        }

        nImportsM.set(unit, importees.size);
    }

    const sorted: SourceUnit[] = [];
    const q = units.filter((unit) => (nImportsM.get(unit) as number) === 0);

    while (q.length > 0) {
        const cur = q.shift() as SourceUnit;

        sorted.push(cur);

        for (const importer of getOrInit(cur, importersM, new Set())) {
            const newNImports = (nImportsM.get(importer) as number) - 1;

            assert(newNImports >= 0, ``);

            nImportsM.set(importer, newNImports);

            if (newNImports === 0) {
                q.push(importer);
            }
        }
    }

    assert(
        sorted.length === units.length,
        `Topo sort didn't preserve list: sorted - ${sorted.length} original - ${units.length}`
    );

    return sorted;
}

type TargetType = "function" | "variable" | "contract";
interface PropertyDesc {
    id: number;
    contract: string;
    filename: string;
    propertySource: string;
    target: TargetType;
    targetName: string;
    debugEventSignature: string;
    message: string;
}
type PropertyMap = PropertyDesc[];

function generatePropertyMap(ctx: InstrumentationContext): PropertyMap {
    const result: PropertyMap = [];

    for (const annotation of ctx.annotations) {
        let contract: ContractDefinition;
        let targetType: TargetType;

        if (annotation.target instanceof FunctionDefinition) {
            assert(
                annotation.target.vScope instanceof ContractDefinition,
                "Instrumenting free functions is not supported yet"
            );

            contract = annotation.target.vScope;
            targetType = "function";
        } else if (annotation.target instanceof VariableDeclaration) {
            assert(
                annotation.target.vScope instanceof ContractDefinition,
                "Instrumenting is supported for state variables only"
            );

            contract = annotation.target.vScope;
            targetType = "variable";
        } else {
            contract = annotation.target;
            targetType = "contract";
        }

        const targetName = annotation.targetName;
        const filename = contract.vScope.sourceEntryKey;

        const unit = contract.vScope;
        const predRange = annotation.predicateFileLoc(ctx.files.get(unit.sourceEntryKey) as string);
        const debugEvent = ctx.debugEventDefs.get(annotation.id);
        const signature = debugEvent !== undefined ? debugEvent.canonicalSignature : "";
        const propertySource = `${predRange.start.offset}:${
            predRange.end.offset - predRange.start.offset
        }:${unit.sourceListIndex}`;

        result.push({
            id: annotation.id,
            contract: contract.name,
            filename,
            propertySource,
            target: targetType,
            targetName,
            debugEventSignature: signature,
            message: annotation.message
        });
    }

    return result;
}

function stripSourcemaps(contractJSON: any): void {
    for (const unitName in contractJSON) {
        for (const contractName in contractJSON[unitName]) {
            const compiledArtifact = contractJSON[unitName][contractName];

            for (const bytecodeType in ["bytecode", "deployedBytecode"]) {
                if ("evm" in compiledArtifact && bytecodeType in compiledArtifact.evm) {
                    compiledArtifact.evm[bytecodeType].sourceMap = "";
                }
            }
        }
    }
}

/**
 * Add the actual source code to the compiled artifcat's AST data
 */
function addSrcToContext(r: CompileResult): any {
    for (const [fileName] of Object.entries(r.data["sources"])) {
        r.data["sources"]["source"] = r.files.get(fileName);
    }

    return r.data["sources"];
}

function buildOutputJSON(ctx: InstrumentationContext, flatCompiled: CompileResult): any {
    const result: any = {};

    if ("errors" in flatCompiled.data) {
        result["errors"] = flatCompiled.data.errors;
    }

    result["sources"] = addSrcToContext(flatCompiled);

    stripSourcemaps(flatCompiled.data["contracts"]);

    result["contracts"] = flatCompiled.data["contracts"];
    result["propertyMap"] = generatePropertyMap(ctx);

    return result;
}

function writeOut(contents: string, fileName: string) {
    if (fileName === "--") {
        console.log(contents);
    } else {
        fse.writeFileSync(fileName, contents);
    }
}

function makeUtilsUnit(
    utilsOutputDir: string,
    factory: ASTNodeFactory,
    version: string
): SourceUnit {
    let utilsPath = "__scribble_ReentrancyUtils.sol";
    let utilsAbsPath = "__scribble_ReentrancyUtils.sol";

    if (utilsOutputDir !== "--") {
        utilsPath = path.join(utilsOutputDir, "__scribble_ReentrancyUtils.sol");

        utilsAbsPath = path.join(
            fse.realpathSync(utilsOutputDir),
            "__scribble_ReentrancyUtils.sol"
        );
    }

    return generateUtilsContract(factory, utilsPath, utilsAbsPath, version);
}

function copy(from: string, to: string, options: any): void {
    if (!options.quiet) {
        console.error(`Copying ${from} to ${to}`);
    }

    fse.copyFileSync(from, to);
}

function move(from: string, to: string, options: any): void {
    if (!options.quiet) {
        console.error(`Moving ${from} to ${to}`);
    }

    fse.moveSync(from, to, { overwrite: true });
}

function remove(filePath: string, options: any): void {
    if (!options.quiet) {
        console.error(`Removing ${filePath}`);
    }

    fse.removeSync(filePath);
}

/**
 * Given a map of the versions used for the various targets try and select a single version.
 * @param versionUsedMap
 */
function pickVersion(versionUsedMap: Map<string, string>): string {
    const versions = [...new Set([...versionUsedMap.values()])];

    if (versions.length !== 1) {
        error(
            `Multiple compiler versions detected: ${versions}. Please specify an exact version to use with '--compiler-version'.`
        );
    }
    return versions[0];
}

if ("version" in options) {
    const { version } = require("../../package.json");

    console.log(version);
} else if ("help" in options || !("solFiles" in options)) {
    const usage = commandLineUsage(params);

    console.log(usage);
} else {
    const targets: string[] = options.solFiles;
    const addAssert = "no-assert" in options ? false : true;

    const inputMode: "source" | "json" = oneOf(
        options["input-mode"],
        ["source", "json"],
        `Error: --input-mode must be either source or json`
    );

    const pathRemapping: string[] = options["path-remapping"]
        ? options["path-remapping"].split(";")
        : [];

    const compilerVersion: string =
        options["compiler-version"] !== undefined ? options["compiler-version"] : "auto";

    const filterOptions: AnnotationFilterOptions = {};

    if (options["filter-type"]) {
        filterOptions.type = options["filter-type"];
    }

    if (options["filter-message"]) {
        filterOptions.message = options["filter-message"];
    }

    const targetDir =
        targets[0] !== "--"
            ? relative(process.cwd(), dirname(fse.realpathSync(targets[0])))
            : targets[0];
    const utilsOutputDir =
        options["utils-output-path"] === undefined ? targetDir : options["utils-output-path"];

    const assertionMode: "log" | "mstore" = oneOf(
        options["user-assert-mode"],
        ["log", "mstore"],
        `Error: --user-assert-mode must be either log or mstore, not ${options["user-assert-mode"]}`
    );

    const debugEvents: boolean =
        options["debug-events"] !== undefined ? options["debug-events"] : false;

    const outputMode: "flat" | "files" | "json" = oneOf(
        options["output-mode"],
        ["flat", "files", "json"],
        `Error: --output-mode must be either 'flat', 'files' or 'json`
    );

    const compilerVersionUsedMap: Map<string, string> = new Map();
    const groupsMap: Map<string, SourceUnit[]> = new Map();
    const ctxtsMap: Map<string, ASTContext> = new Map();
    const filesMap: Map<string, Map<string, string>> = new Map();
    const originalFiles: Set<string> = new Set();
    const instrumentationFiles: Set<string> = new Set();

    /**
     * Try to compile each target.
     */
    for (const target of targets) {
        try {
            let targetResult: CompileResult;

            try {
                targetResult = compile(target, inputMode, compilerVersion, pathRemapping);
            } catch (e) {
                if (e instanceof CompileFailedError) {
                    console.error(`Compile errors encountered for ${target}:`);

                    for (const failure of e.failures) {
                        console.error(
                            failure.compilerVersion
                                ? `SolcJS ${failure.compilerVersion}:`
                                : `Unknown compiler`
                        );

                        for (const error of failure.errors) {
                            console.error(error);
                        }
                    }
                } else {
                    console.error(e.message);
                }

                process.exit(1);
            }

            if (options["disarm"]) {
                for (const [targetName] of targetResult.files) {
                    const originalFileName = targetName + ".original";
                    const instrFileName = targetName + ".instrumented";

                    if (fse.existsSync(originalFileName)) {
                        originalFiles.add(originalFileName);
                    }

                    if (fse.existsSync(instrFileName)) {
                        instrumentationFiles.add(instrFileName);
                    }
                }

                if (utilsOutputDir !== "--") {
                    const helperFileName = path.join(
                        utilsOutputDir,
                        "__scribble_ReentrancyUtils.sol"
                    );

                    if (fse.existsSync(helperFileName)) {
                        instrumentationFiles.add(helperFileName);
                    }
                }

                continue;
            }

            const compilerVersionUsed: string =
                targetResult.compilerVersion !== undefined
                    ? targetResult.compilerVersion
                    : compilerVersion;

            if (compilerVersionUsed === "auto") {
                error(
                    `When passing in JSON you must specify an explicit compiler version with --compiler-version`
                );
            }

            const ctx = new ASTContext();
            const reader = new ASTReader(ctx);

            if (targetResult.files.size === 0) {
                error(
                    `Missing source files in input. Did you pass in JSON without a sources entry?`
                );
            }

            const originalUnits = reader.read(targetResult.data, undefined, targetResult.files);
            /**
             * This is inefficient, but we re-create the utils source unit for every target. This is due to
             * the inability to merge the id-spaces of the nodes of different compilation results.
             */
            compilerVersionUsedMap.set(target, compilerVersionUsed);
            groupsMap.set(target, originalUnits);
            ctxtsMap.set(target, ctx);
            filesMap.set(target, targetResult.files);
        } catch (e) {
            console.error(e);

            process.exit(1);
        }
    }

    if (options["disarm"]) {
        // In disarm mode we don't need to instrument - just replace the instrumented files with the `.original` files
        for (const originalFileName of originalFiles) {
            move(originalFileName, originalFileName.replace(".sol.original", ".sol"), options);
        }
        if (!options["keep-instrumented"]) {
            for (const instrFileName of instrumentationFiles) {
                remove(instrFileName, options);
            }
        }
    } else {
        // Without --disarm we need to instrument and output something.

        /**
         * Merge the CHAs and file maps computed for each target
         */
        const contentsMap: Map<string, string> = new Map();
        const contractsInvMap: Map<ContractDefinition, Annotation[]> = new Map();

        const groups: SourceUnit[][] = targets.map(
            (target) => groupsMap.get(target) as SourceUnit[]
        );

        const [mergedUnits, mergedCtx] = merge(groups);

        // Check that merging produced sane ASTs
        for (const mergedUnit of mergedUnits) {
            assert(
                isSane(mergedUnit, mergedCtx),
                `Merged unit ${mergedUnit.absolutePath} is insante`
            );
        }

        for (const target of targets) {
            const units = groupsMap.get(target) as SourceUnit[];
            const files = filesMap.get(target) as Map<string, string>;

            for (const unit of units) {
                if (!contentsMap.has(unit.absolutePath)) {
                    if (files.has(unit.sourceEntryKey)) {
                        contentsMap.set(
                            unit.absolutePath,
                            files.get(unit.sourceEntryKey) as string
                        );
                    }
                }
            }
        }

        const cha = getCHA(mergedUnits);
        const callgraph = getCallGraph(mergedUnits);
        computeContractInvs(cha, filterOptions, contentsMap, contractsInvMap);

        /**
         * Walk over the computed CHA and compute:
         *  1. The set of contracts that have contract invariants (as the map contractInvs)
         *  2. The set of contracts that NEED contract instrumentation (because they, a parent of theirs, or a child of theirs has contract invariants)
         */
        const contractsNeedingInstr = computeContractsNeedingInstr(cha, contractsInvMap);

        const compilerVersionUsed = pickVersion(compilerVersionUsedMap);

        const factory = new ASTNodeFactory(mergedCtx);
        const utilsUnit = makeUtilsUnit(utilsOutputDir, factory, compilerVersionUsed);

        if (outputMode === "flat" || outputMode === "json") {
            // In flat/json mode fix-up any naming issues due to 'import {a as
            // b} from ...' and name collisions.
            fixNameConflicts(mergedUnits);
            fixRenamingErrors(mergedUnits);
        }
        /**
         * Next try to instrument the merged SourceUnits.         */
        const instrCtx: InstrumentationContext = {
            factory,
            units: mergedUnits,
            assertionMode,
            utilsContract: single(utilsUnit.vContracts),
            addAssert,
            callgraph: callgraph,
            cha: cha,
            funsToChangeMutability: new Set<FunctionDefinition>(),
            filterOptions,
            annotations: [],
            wrapperMap: new Map(),
            files: contentsMap,
            compilerVersion: compilerVersionUsed,
            debugEvents,
            debugEventDefs: new Map()
        };

        const [allUnits, changedUnits] = instrumentFiles(
            instrCtx,
            contractsInvMap,
            contractsNeedingInstr
        );

        allUnits.push(utilsUnit);

        const versionMap: Map<SourceUnit, string> = new Map(
            mergedUnits.map((u) => [u, compilerVersionUsed])
        );

        // Next we re-write the imports. We want to do this here, as the imports are need by the topo sort
        allUnits.forEach((sourceUnit) => {
            if (contentsMap.has(sourceUnit.absolutePath)) {
                rewriteImports(sourceUnit, contentsMap);
            }
        });

        if (outputMode === "flat" || outputMode === "json") {
            // For flat and json modes, we need to flatten out the output. This goes in several steps.

            // 1. Sort units in topological order by imports
            const sortedUnits = topoSort(allUnits);

            // 2. Strip import and compiler pragma directives
            sortedUnits.forEach((unit) => {
                for (const node of unit.vImportDirectives) {
                    unit.removeChild(node);
                }

                for (const node of unit.vPragmaDirectives) {
                    if (node.vIdentifier === "solidity") {
                        unit.removeChild(node);
                    }
                }
            });

            // 3. Next insert a single compiler version directive
            const version = pickVersion(compilerVersionUsedMap);

            sortedUnits[0].appendChild(factory.makePragmaDirective(["solidity", version]));

            // 5. Now print the stripped files
            const newContents: Map<SourceUnit, string> = printUnits(sortedUnits, versionMap);

            // 6. Join all the contents in-order
            const flatContents = sortedUnits
                .reduce((a, b) => (a + `\n` + newContents.get(b)) as string, "")
                .trimStart();

            // 7. If the output mode is just 'flat' we just write out the contents now.
            if (outputMode === "flat") {
                writeOut(flatContents, options.output);
            } else {
                // 8. If the output mode is 'json' we have more work - need to re-compile the flattened results.
                let flatCompiled: CompileResult;
                try {
                    flatCompiled = compileSourceString(
                        `flattened.sol`,
                        flatContents,
                        version,
                        pathRemapping
                    );
                } catch (e) {
                    if (e instanceof CompileFailedError) {
                        console.error(`Compile errors encountered for flattend instrumetned file:`);

                        for (const failure of e.failures) {
                            console.error(
                                failure.compilerVersion
                                    ? `SolcJS ${failure.compilerVersion}:`
                                    : `Unknown compiler`
                            );

                            for (const error of failure.errors) {
                                console.error(error);
                            }
                        }
                    } else {
                        console.error(e.message);
                    }

                    process.exit(1);
                }

                const resultJSON = JSON.stringify(
                    buildOutputJSON(instrCtx, flatCompiled),
                    undefined,
                    2
                );

                writeOut(resultJSON, options.output);
            }
        } else {
            // In files mode we need to write out every change file, and opitonally swap them in-place.

            // 1. Write out files
            const newContents = printUnits(allUnits.concat(utilsUnit), versionMap);

            // 2. For all changed files write out a `.instrumented` version of the file.
            for (const unit of changedUnits) {
                const instrumentedFileName = unit.absolutePath + ".instrumented";

                if (!options.quiet) {
                    console.error(`${unit.absolutePath} -> ${instrumentedFileName}`);
                }

                fse.writeFileSync(instrumentedFileName, newContents.get(unit) as string);
            }

            // 3. Write out the utils contract
            fse.writeFileSync(utilsUnit.absolutePath, newContents.get(utilsUnit) as string);

            // 4. Finally if --arm is passed put the instrumented files in-place
            if (options["arm"]) {
                for (const unit of changedUnits) {
                    const instrumentedFileName = unit.absolutePath + ".instrumented";
                    const originalFileName = unit.absolutePath + ".original";

                    copy(unit.absolutePath, originalFileName, options);
                    copy(instrumentedFileName, unit.absolutePath, options);
                }
            }
        }

        if (options["property-map-file"] !== undefined) {
            const propertyMap: any = {
                propertyMap: generatePropertyMap(instrCtx)
            };

            const propertyJSON = JSON.stringify(propertyMap, undefined, 2);

            writeOut(propertyJSON, options["property-map-file"]);
        }
    }
}
