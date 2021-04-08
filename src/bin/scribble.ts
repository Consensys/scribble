#!/usr/bin/env node
import fse from "fs-extra";
import { dirname, relative, join } from "path";
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
    ImportDirective,
    MemberAccess,
    ParameterList,
    SourceUnit,
    SrcRangeMap,
    StructDefinition,
    UserDefinedTypeName,
    VariableDeclaration
} from "solc-typed-ast";
import { findAliasedStateVars, findStateVarUpdates, replaceNode, UnsupportedConstruct } from "..";
import { print, rewriteImports } from "../ast_to_source_printer";
import {
    PropertyMetaData,
    SyntaxError,
    UnsupportedByTargetError,
    AnnotationMetaData,
    UserFunctionDefinitionMetaData,
    buildAnnotationMap,
    AnnotationMap,
    gatherFunctionAnnotations,
    AnnotationFilterOptions
} from "../instrumenter/annotations";
import { getCallGraph } from "../instrumenter/callgraph";
import { CHA, getCHA } from "../instrumenter/cha";
import {
    ContractInstrumenter,
    FunctionInstrumenter,
    generateUtilsContract
} from "../instrumenter/instrument";
import { instrumentStateVars } from "../instrumenter/state_var_instrumenter";
import { InstrumentationContext } from "../instrumenter/instrumentation_context";
import { merge } from "../rewriter/merge";
import { isSane } from "../rewriter/sanity";
import { Location, Range } from "../spec-lang/ast";
import { scUnits, SemError, SemMap, STypeError, tcUnits, TypeEnv } from "../spec-lang/tc";
import {
    assert,
    getOrInit,
    getScopeUnit,
    isChangingState,
    isExternallyVisible,
    pp,
    buildOutputJSON,
    generateInstrumentationMetadata,
    flatten,
    dedup,
    topoSort,
    getOr
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
    annotation?: string
): never {
    const coords =
        "line" in location
            ? `${location.line}:${location.column}`
            : `${location.start.line}:${location.start.column}`;

    const descriptionLines = [`${unit.absolutePath}:${coords} ${type}: ${message}`];

    if (annotation !== undefined) {
        descriptionLines.push("In:", annotation);
    }

    error(descriptionLines.join("\n\n"));
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

/**
 * Not all contracts in the CHA need to have contract-wide invariants instrumentation.
 *
 * If we consider the CHA to consist of disjoint DAGs, then a contract needs contract-invariant
 * instrumentation IFF at least one contract in it's DAG has contract invariant annotations.
 *
 * @param cha - contract inheritance hierarchy
 * @param annotMap - map with extracted contract annotations
 */
function computeContractsNeedingInstr(
    cha: CHA<ContractDefinition>,
    annotMap: AnnotationMap
): Set<ContractDefinition> {
    // Find the contracts needing instrumentaion by doing bfs starting from the annotated contracts
    const wave = [...annotMap.entries()]
        .filter(
            ([n, annots]) =>
                n instanceof ContractDefinition &&
                annots.filter((annot) => annot instanceof PropertyMetaData).length > 0
        )
        .map(([contract]) => contract);
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
    annotMap: AnnotationMap,
    contractsNeedingInstr: Set<ContractDefinition>
): [SourceUnit[], SourceUnit[]] {
    const units = ctx.units;

    const worklist: Array<
        [ContractDefinition, FunctionDefinition | undefined, AnnotationMetaData[]]
    > = [];
    const stateVarsWithAnnot: VariableDeclaration[] = [];

    const changedSourceUnits: SourceUnit[] = [];

    for (const unit of units) {
        let changed = false;

        const contents = ctx.files.get(unit.sourceEntryKey);

        assert(contents !== undefined, `Missing source for ${unit.absolutePath}`);

        for (const contract of unit.vContracts) {
            const contractAnnot = getOr(annotMap, contract, []);
            const needsStateInvariantInstr = contractsNeedingInstr.has(contract);

            const userFuns = contractAnnot.filter(
                (annot) => annot instanceof UserFunctionDefinitionMetaData
            );

            // Nothing to instrument on interfaces
            if (contract.kind === ContractKind.Interface) {
                continue;
            }

            if (needsStateInvariantInstr || userFuns.length > 0) {
                worklist.push([contract, undefined, contractAnnot]);
                changed = true;
                assert(
                    ![ContractKind.Library, ContractKind.Interface].includes(contract.kind),
                    `Shouldn't be instrumenting ${contract.kind} ${contract.name} with contract invs`
                );
            }

            for (const stateVar of contract.vStateVariables) {
                const stateVarAnnots = getOr(annotMap, stateVar, []);
                if (stateVarAnnots.length > 0) {
                    stateVarsWithAnnot.push(stateVar);
                }
            }

            for (const fun of contract.vFunctions) {
                // Skip functions without a body
                if (fun.vBody === undefined) {
                    continue;
                }

                const annotations = gatherFunctionAnnotations(fun, annotMap);
                /**
                 * We interpose on functions if either of these is true
                 *  a) They have annotations
                 *  b) They are external or public AND they modify state (not constant/pure/view) AND they are not the constructor AND they are not fallback/receive
                 *
                 * Note: Constructors are instrumented in instrumentContract, not by instrumentFunction. fallback() and receive() don't check state invariants.
                 */
                if (
                    annotations.length > 0 ||
                    (needsStateInvariantInstr &&
                        isExternallyVisible(fun) &&
                        isChangingState(fun) &&
                        contract.kind === ContractKind.Contract &&
                        fun.kind === FunctionKind.Function)
                ) {
                    changed = true;

                    worklist.push([contract, fun, annotations]);
                }
            }
        }

        if (changed) {
            changedSourceUnits.push(unit);
        }
    }

    const contractInstrumenter = new ContractInstrumenter();
    const functionInstrumenter = new FunctionInstrumenter();

    for (const [contract, contractElement, annotations] of worklist) {
        if (contractElement === undefined) {
            contractInstrumenter.instrument(
                ctx,
                annotations,
                contract,
                contractsNeedingInstr.has(contract)
            );
        } else {
            functionInstrumenter.instrument(
                ctx,
                annotations,
                contract,
                contractElement,
                contractsNeedingInstr.has(contract)
            );
        }
    }

    if (stateVarsWithAnnot.length > 0) {
        const aliasedStateVars = findAliasedStateVars(ctx.units);
        const stateVarUpdates = findStateVarUpdates(ctx.units);

        instrumentStateVars(ctx, annotMap, aliasedStateVars, stateVarUpdates);
    }

    ctx.finalize();
    return [units, changedSourceUnits];
}

function printUnits(
    all: SourceUnit[],
    version: Map<SourceUnit, string>,
    srcMap: SrcRangeMap
): Map<SourceUnit, string> {
    return print(all, version, srcMap);
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
    def:
        | ContractDefinition
        | FunctionDefinition
        | StructDefinition
        | EnumDefinition
        | VariableDeclaration,
    atUseSite: ASTNode
): string {
    if (def instanceof ContractDefinition) {
        return def.name;
    }

    const scope = def.vScope;
    assert(scope instanceof SourceUnit || scope instanceof ContractDefinition, ``);

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
function fixRenamingErrors(units: SourceUnit[], factory: ASTNodeFactory): void {
    for (const unit of units) {
        for (const child of unit.getChildrenBySelector(
            (node) =>
                node instanceof Identifier ||
                node instanceof UserDefinedTypeName ||
                node instanceof MemberAccess
        )) {
            const refNode = child as Identifier | UserDefinedTypeName | MemberAccess;
            const def = refNode.vReferencedDeclaration;

            // Skip builtin identifiers
            if (
                refNode instanceof Identifier &&
                refNode.vIdentifierType !== ExternalReferenceType.UserDefined
            ) {
                continue;
            }

            // Skip identifiers not refereing to material imports
            if (
                !(
                    def instanceof ContractDefinition ||
                    def instanceof StructDefinition ||
                    def instanceof EnumDefinition ||
                    def instanceof FunctionDefinition ||
                    def instanceof VariableDeclaration
                )
            ) {
                continue;
            }

            // For VariableDeclarations we only care about file-level constants
            // and state vars with fully-qualified names. All other
            // VariableDeclarations cannot be broken by renaming.
            // Cases where the base is a contract name are handled by identifier-renaming.
            if (
                def instanceof VariableDeclaration &&
                !(
                    (def.vScope instanceof SourceUnit ||
                        def.vScope instanceof ContractDefinition) &&
                    refNode instanceof MemberAccess
                )
            ) {
                continue;
            }

            const fqDefName = getFQName(def, refNode);

            // For member accesses we only care about member accesses where the base is a source unit
            if (refNode instanceof MemberAccess) {
                const baseExp = refNode.vExpression;

                if (
                    !(
                        baseExp instanceof Identifier &&
                        (baseExp.vReferencedDeclaration instanceof SourceUnit ||
                            baseExp.vReferencedDeclaration instanceof ImportDirective)
                    )
                ) {
                    continue;
                }

                // Replace the base member access with the right identifier
                const newNode = factory.makeIdentifierFor(def);
                replaceNode(refNode, newNode);

                continue;
            }

            if (fqDefName !== refNode.name) {
                refNode.name = fqDefName;
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
 * Sort source units in topological order based on their imports.
 *
 * @param units - units to sort
 */
function sortUnits(units: SourceUnit[]): SourceUnit[] {
    // Map from absolute paths to source units
    const pathMap = new Map(units.map((unit) => [unit.absolutePath, unit]));
    // Partial order of imports
    const order: Array<[SourceUnit, SourceUnit]> = [];

    for (const unit of units) {
        const seen = new Set<SourceUnit>();
        for (const imp of unit.vImportDirectives) {
            const importee = pathMap.get(imp.vSourceUnit.absolutePath);
            assert(importee !== undefined, ``);
            // Avoid duplicats in order
            if (seen.has(importee)) {
                continue;
            }
            seen.add(importee);
            order.push([importee, unit]);
        }
    }

    return topoSort(units, order);
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
    version: string,
    ctx: InstrumentationContext
): SourceUnit {
    let utilsPath = "__scribble_ReentrancyUtils.sol";
    let utilsAbsPath = "__scribble_ReentrancyUtils.sol";

    if (utilsOutputDir !== "--") {
        utilsPath = join(utilsOutputDir, "__scribble_ReentrancyUtils.sol");

        utilsAbsPath = join(fse.realpathSync(utilsOutputDir), "__scribble_ReentrancyUtils.sol");
    }

    return generateUtilsContract(factory, utilsPath, utilsAbsPath, version, ctx);
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

const pkg = fse.readJSONSync(join(__dirname, "../../package.json"), { encoding: "utf-8" });

if ("version" in options) {
    console.log(pkg.version);
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
                    const helperFileName = join(utilsOutputDir, "__scribble_ReentrancyUtils.sol");

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
        let annotMap: AnnotationMap;

        try {
            annotMap = buildAnnotationMap(mergedUnits, contentsMap, filterOptions);
        } catch (e) {
            if (e instanceof SyntaxError || e instanceof UnsupportedByTargetError) {
                const unit = getScopeUnit(e.target);

                prettyError(e.constructor.name, e.message, unit, e.range.start, e.annotation);
            }

            throw e;
        }

        const typeEnv = new TypeEnv();
        const semMap: SemMap = new Map();

        try {
            // Type check
            tcUnits(mergedUnits, annotMap, typeEnv);
            // Semantic check
            scUnits(mergedUnits, annotMap, typeEnv, semMap);
        } catch (err) {
            if (err instanceof STypeError || err instanceof SemError) {
                const annotation = err.annotationMetaData;
                const unit = annotation.target.getClosestParentByType(SourceUnit) as SourceUnit;
                const source = contentsMap.get(unit.sourceEntryKey) as string;
                const loc = err.loc();
                let fileLoc;

                if (annotation instanceof PropertyMetaData) {
                    fileLoc = annotation.predOffToFileLoc(
                        [loc.start.offset, loc.end.offset],
                        source
                    );
                } else if (annotation instanceof UserFunctionDefinitionMetaData) {
                    fileLoc = annotation.bodyOffToFileLoc(
                        [loc.start.offset, loc.end.offset],
                        source
                    );
                } else {
                    throw new Error(`NYI Annotation MD for ${annotation.parsedAnnot.pp()}`);
                }

                prettyError("TypeError", err.message, unit, fileLoc, annotation.original);
            } else {
                error(`Internal error in type-checking: ${err.message}`);
            }
        }

        /**
         * Walk over the computed CHA and compute:
         *  1. The set of contracts that have contract invariants (as the map contractInvs)
         *  2. The set of contracts that NEED contract instrumentation (because they, a parent of theirs, or a child of theirs has contract invariants)
         */
        const contractsNeedingInstr = computeContractsNeedingInstr(cha, annotMap);

        const compilerVersionUsed = pickVersion(compilerVersionUsedMap);

        const factory = new ASTNodeFactory(mergedCtx);

        if (outputMode === "flat" || outputMode === "json") {
            // In flat/json mode fix-up any naming issues due to 'import {a as
            // b} from ...' and name collisions.
            fixNameConflicts(mergedUnits);
            fixRenamingErrors(mergedUnits, factory);
        }
        /**
         * Next try to instrument the merged SourceUnits.
         */
        const instrCtx = new InstrumentationContext(
            factory,
            mergedUnits,
            assertionMode,
            addAssert,
            callgraph,
            cha,
            new Set<FunctionDefinition>(),
            filterOptions,
            dedup(flatten(annotMap.values())),
            new Map(),
            contentsMap,
            compilerVersionUsed,
            debugEvents,
            new Map(),
            outputMode,
            typeEnv,
            semMap
        );

        const utilsUnit = makeUtilsUnit(utilsOutputDir, factory, compilerVersionUsed, instrCtx);

        let allUnits: SourceUnit[];
        let changedUnits: SourceUnit[];

        try {
            [allUnits, changedUnits] = instrumentFiles(instrCtx, annotMap, contractsNeedingInstr);
        } catch (e) {
            if (e instanceof UnsupportedConstruct) {
                prettyError(e.name, e.message, e.unit, e.range);
            }
            throw e;
        }

        allUnits.push(utilsUnit);

        const versionMap: Map<SourceUnit, string> = new Map(
            mergedUnits.map((u) => [u, compilerVersionUsed])
        );

        // Next we re-write the imports. We want to do this here, as the imports are need by the topo sort
        allUnits.forEach((sourceUnit) => {
            if (contentsMap.has(sourceUnit.absolutePath)) {
                rewriteImports(sourceUnit, contentsMap, factory);
            }
        });

        let newSrcMap: SrcRangeMap = new Map();
        let originalUnits: SourceUnit[];

        if (outputMode === "flat" || outputMode === "json") {
            // For flat and json modes, we need to flatten out the output. This goes in several steps.

            // 1. Sort units in topological order by imports
            const sortedUnits = sortUnits(allUnits);

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
            const newContents: Map<SourceUnit, string> = printUnits(
                sortedUnits,
                versionMap,
                newSrcMap
            );

            // 6. Join all the contents in-order
            const flatSrcMap: SrcRangeMap = new Map();
            let flatContents = "";

            for (let i = 0; i < sortedUnits.length; i++) {
                const unit = sortedUnits[i];

                if (flatContents !== "") flatContents += "\n";

                unit.walkChildren((node) => {
                    const localSrc = newSrcMap.get(node);
                    if (localSrc === undefined) {
                        assert(
                            node instanceof ParameterList,
                            `Missing source for node ${pp(node)}`
                        );
                        return;
                    }

                    flatSrcMap.set(node, [flatContents.length + localSrc[0], localSrc[1]]);
                });
                flatContents += newContents.get(unit);
            }

            newSrcMap = flatSrcMap;
            originalUnits = sortedUnits;

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
                    buildOutputJSON(
                        instrCtx,
                        flatCompiled,
                        sortedUnits,
                        flatSrcMap,
                        pkg.version,
                        options.output,
                        options["arm"] !== undefined
                    ),
                    undefined,
                    2
                );

                writeOut(resultJSON, options.output);
            }
        } else {
            // In files mode we need to write out every change file, and opitonally swap them in-place.

            // 1. Write out files
            const newContents = printUnits(allUnits.concat(utilsUnit), versionMap, newSrcMap);

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

            originalUnits = changedUnits.concat(utilsUnit);
        }

        if (options["instrumentation-metadata-file"] !== undefined) {
            const metadata: any = generateInstrumentationMetadata(
                instrCtx,
                newSrcMap,
                originalUnits,
                options["arm"] !== undefined,
                pkg.version,
                options["output"]
            );

            writeOut(
                JSON.stringify(metadata, undefined, 2),
                options["instrumentation-metadata-file"]
            );
        }
    }
}
