#!/usr/bin/env node
import fse from "fs-extra";
import { dirname, join, relative } from "path";
import {
    ASTContext,
    ASTNodeFactory,
    ASTReader,
    CompilationOutput,
    CompileFailedError,
    compileJson,
    compileJsonData,
    CompileResult,
    compileSol,
    compileSourceString,
    ContractDefinition,
    ContractKind,
    FunctionDefinition,
    FunctionKind,
    FunctionStateMutability,
    FunctionVisibility,
    getABIEncoderVersion,
    isSane,
    SourceUnit,
    SrcRangeMap,
    Statement,
    StatementWithChildren,
    VariableDeclaration
} from "solc-typed-ast";
import {
    AbsDatastructurePath,
    AnnotationTarget,
    findStateVarUpdates,
    generateUtilsContract,
    instrumentContract,
    instrumentFunction,
    instrumentStatement,
    interposeMap,
    ScribbleFactory,
    UnsupportedConstruct
} from "..";
import { rewriteImports } from "../ast_to_source_printer";
import {
    AnnotationFilterOptions,
    AnnotationMap,
    AnnotationMetaData,
    buildAnnotationMap,
    gatherContractAnnotations,
    gatherFunctionAnnotations,
    PropertyMetaData,
    SyntaxError,
    UnsupportedByTargetError,
    UserFunctionDefinitionMetaData
} from "../instrumenter/annotations";
import { getCallGraph } from "../instrumenter/callgraph";
import { CHA, getCHA } from "../instrumenter/cha";
import { InstrumentationContext } from "../instrumenter/instrumentation_context";
import { instrumentStateVars } from "../instrumenter/state_var_instrumenter";
import { flattenUnits } from "../rewriter/flatten";
import { merge } from "../rewriter/merge";
import { AnnotationType, Location, Range } from "../spec-lang/ast";
import { scUnits, SemError, SemMap, STypeError, tcUnits, TypeEnv } from "../spec-lang/tc";
import {
    assert,
    buildOutputJSON,
    dedup,
    flatten,
    generateInstrumentationMetadata,
    getOr,
    getScopeUnit,
    isChangingState,
    isExternallyVisible
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

function printDeprecationNotices(annotMap: AnnotationMap): void {
    const unprefixed: AnnotationMetaData[] = [];

    for (const annotMetas of annotMap.values()) {
        for (const annotMeta of annotMetas) {
            if (annotMeta.parsedAnnot.prefix === undefined) {
                unprefixed.push(annotMeta);
            }
        }
    }

    if (unprefixed.length > 0) {
        const delimiter = "-".repeat(45);
        const notice: string[] = [
            delimiter,
            '[notice] Annotations without "#" prefix are deprecated:',
            ""
        ];

        for (const annotMeta of unprefixed) {
            const unit = annotMeta.target.root as SourceUnit;
            const location = annotMeta.annotationFileRange;
            const coords = `${location.start.line}:${location.start.column}`;
            const type = annotMeta.type;

            notice.push(`${unit.absolutePath}:${coords} ${type} should be #${type}`);
        }

        notice.push(delimiter);

        console.warn(notice.join("\n"));
    }
}

function compile(
    fileName: string,
    type: "source" | "json",
    compilerVersion: string,
    remapping: string[],
    compilerSettings: any
): CompileResult {
    const astOnlyOutput = [
        CompilationOutput.AST,
        CompilationOutput.ABI,
        CompilationOutput.DEVDOC,
        CompilationOutput.USERDOC
    ];

    if (fileName === "--") {
        const content = fse.readFileSync(0, { encoding: "utf-8" });

        fileName = "stdin";

        return type === "json"
            ? compileJsonData(
                  fileName,
                  JSON.parse(content),
                  compilerVersion,
                  remapping,
                  astOnlyOutput,
                  compilerSettings
              )
            : compileSourceString(
                  fileName,
                  content,
                  compilerVersion,
                  remapping,
                  astOnlyOutput,
                  compilerSettings
              );
    }

    if (!fileName || !fse.existsSync(fileName)) {
        throw new Error("Path not found");
    }

    const stats = fse.statSync(fileName);

    if (!stats.isFile()) {
        throw new Error("Target is not a file");
    }

    return type === "json"
        ? compileJson(fileName, compilerVersion, remapping, astOnlyOutput, compilerSettings)
        : compileSol(fileName, compilerVersion, remapping, astOnlyOutput, compilerSettings);
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
                annots.filter(
                    (annot) =>
                        annot instanceof PropertyMetaData && annot.type === AnnotationType.Invariant
                ).length > 0
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
) {
    const units = ctx.units;

    const worklist: Array<[AnnotationTarget, AnnotationMetaData[]]> = [];
    const stateVarsWithAnnot: VariableDeclaration[] = [];

    if (ctx.varInterposingQueue.length > 0) {
        interposeMap(ctx, ctx.varInterposingQueue, units);
    }

    for (const unit of units) {
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
                worklist.push([contract, contractAnnot]);
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
            const allProperties = gatherContractAnnotations(contract, annotMap);
            const allowedFuncProp = allProperties.filter(
                (annot) =>
                    annot instanceof PropertyMetaData && annot.parsedAnnot.type == "if_succeeds"
            );

            for (const fun of contract.vFunctions) {
                // Skip functions without a body
                if (fun.vBody === undefined) {
                    continue;
                }

                let annotations = gatherFunctionAnnotations(fun, annotMap);
                if (
                    (fun.visibility == FunctionVisibility.External ||
                        fun.visibility == FunctionVisibility.Public) &&
                    fun.stateMutability !== FunctionStateMutability.Pure
                ) {
                    annotations = annotations.concat(allowedFuncProp);
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
                    (needsStateInvariantInstr &&
                        isExternallyVisible(fun) &&
                        isChangingState(fun) &&
                        contract.kind === ContractKind.Contract &&
                        fun.kind === FunctionKind.Function)
                ) {
                    worklist.push([fun, annotations]);
                }
            }
        }
    }

    // Finally add in all of the assertions to the worklist
    for (const [target, annots] of annotMap.entries()) {
        if (
            (target instanceof Statement || target instanceof StatementWithChildren) &&
            annots.length > 0
        ) {
            worklist.push([target, annots]);
        }
    }

    for (const [target, annotations] of worklist) {
        if (target instanceof ContractDefinition) {
            instrumentContract(ctx, annotations, target, contractsNeedingInstr.has(target));
        } else if (target instanceof FunctionDefinition) {
            const contract = target.vScope;
            assert(
                contract instanceof ContractDefinition,
                `Function instrumentation allowed only on contract funs`
            );
            instrumentFunction(ctx, annotations, target, contractsNeedingInstr.has(contract));
        } else {
            assert(
                target instanceof Statement || target instanceof StatementWithChildren,
                `State vars handled below`
            );
            instrumentStatement(ctx, annotations, target);
        }
    }

    if (stateVarsWithAnnot.length > 0) {
        const stateVarUpdates = findStateVarUpdates(ctx.units, ctx);

        instrumentStateVars(ctx, annotMap, stateVarUpdates);
    }

    ctx.finalize();
}

/**
 * After the merge of https://github.com/ConsenSys/scribble/issues/80 I started experience segfaults at exit in nodejs
 * with the following stack trace:
 *
 * #0  0x00000000009d047c in v8impl::(anonymous namespace)::RefBase::Finalize(bool) ()
 * #1  0x00000000009ee13f in node_napi_env__::~node_napi_env__() ()
 * #2  0x00000000009c729a in node::Environment::RunCleanup() ()
 * #3  0x0000000000986b77 in node::FreeEnvironment(node::Environment*) ()
 * #4  0x0000000000a5a9df in node::NodeMainInstance::Run() ()
 * #5  0x00000000009e85cc in node::Start(int, char**) ()
 * #6  0x00007fdd1ab43b25 in __libc_start_main () from /usr/lib/libc.so.6
 * #7  0x00000000009819b5 in _start ()
 *
 * The closest reference to this found was this issue: https://github.com/node-webrtc/node-webrtc/issues/636
 * which suggested the below workaround to exit the process without waiting for all cleanups to run.
 */
process.on("beforeExit", (code) => process.exit(code));

const params = cli as any;

let options = params[1].optionList;

for (const option of options) {
    option.type = (global as any)[option.type];
}

try {
    options = commandLineArgs(params[1].optionList);
} catch (e) {
    console.error(e.message);

    process.exit(1);
}

function oneOf(input: any, options: string[], msg: string): any {
    if (!options.includes(input)) {
        error(msg);
    }

    return input;
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

    let compilerSettings: any;

    try {
        compilerSettings =
            options["compiler-settings"] !== undefined
                ? JSON.parse(options["compiler-settings"])
                : undefined;
    } catch (e) {
        error(
            `--compiler-settings expects a valid JSON string, not ${options["compiler-settings"]}`
        );
    }

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
                targetResult = compile(
                    target,
                    inputMode,
                    compilerVersion,
                    pathRemapping,
                    compilerSettings
                );
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

        const compilerVersionUsed = pickVersion(compilerVersionUsedMap);

        const encoderVer = getABIEncoderVersion(mergedUnits, compilerVersionUsed);
        const cha = getCHA(mergedUnits);
        const callgraph = getCallGraph(mergedUnits, encoderVer);
        let annotMap: AnnotationMap;

        try {
            annotMap = buildAnnotationMap(
                mergedUnits,
                contentsMap,
                filterOptions,
                compilerVersionUsed
            );
        } catch (e) {
            if (e instanceof SyntaxError || e instanceof UnsupportedByTargetError) {
                const unit = getScopeUnit(e.target);

                prettyError(e.constructor.name, e.message, unit, e.range.start, e.annotation);
            }

            throw e;
        }

        printDeprecationNotices(annotMap);

        const typeEnv = new TypeEnv(compilerVersionUsed, encoderVer);
        const semMap: SemMap = new Map();
        let interposingQueue: Array<[VariableDeclaration, AbsDatastructurePath]>;

        try {
            // Type check
            tcUnits(mergedUnits, annotMap, typeEnv);
            // Semantic check
            interposingQueue = scUnits(mergedUnits, annotMap, typeEnv, semMap);
        } catch (err) {
            if (err instanceof STypeError || err instanceof SemError) {
                const annotation = err.annotationMetaData;
                const unit = annotation.target.getClosestParentByType(SourceUnit) as SourceUnit;
                const source = contentsMap.get(unit.sourceEntryKey) as string;
                const loc = err.loc();
                let fileLoc;

                if (annotation instanceof PropertyMetaData) {
                    fileLoc = annotation.annotOffToFileLoc(
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
        const factory = new ScribbleFactory(mergedCtx);

        // Next we re-write the imports to fix broken alias references (Some
        // Solidity versions have broken references imports).
        mergedUnits.forEach((sourceUnit) => {
            if (contentsMap.has(sourceUnit.absolutePath)) {
                rewriteImports(sourceUnit, contentsMap, factory);
            }
        });

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
            filterOptions,
            dedup(flatten(annotMap.values())),
            new Map(),
            contentsMap,
            compilerVersionUsed,
            debugEvents,
            new Map(),
            outputMode,
            typeEnv,
            semMap,
            interposingQueue
        );

        const utilsUnit = makeUtilsUnit(utilsOutputDir, factory, compilerVersionUsed, instrCtx);

        try {
            // Check that none of the map state vars to be overwritten is aliased
            for (const [sVar] of interposingQueue) {
                instrCtx.crashIfAliased(sVar);
            }

            instrumentFiles(instrCtx, annotMap, contractsNeedingInstr);
        } catch (e) {
            if (e instanceof UnsupportedConstruct) {
                prettyError(e.name, e.message, e.unit, e.range);
            }
            throw e;
        }

        const allUnits: SourceUnit[] = [...instrCtx.units, utilsUnit];
        let modifiedFiles: SourceUnit[];

        const newSrcMap: SrcRangeMap = new Map();

        if (outputMode === "flat" || outputMode === "json") {
            // 1. Flatten all the source files in a single SourceUnit
            const version = pickVersion(compilerVersionUsedMap);
            const flatUnit = flattenUnits(allUnits, factory, options.output, version);

            modifiedFiles = [flatUnit];

            // 2. Print the flattened unit
            const flatContents = instrCtx
                .printUnits(modifiedFiles, newSrcMap)
                .get(flatUnit) as string;

            // 3. If the output mode is just 'flat' we just write out the contents now.
            if (outputMode === "flat") {
                writeOut(flatContents, options.output);
            } else {
                // 4. If the output mode is 'json' we have more work - need to re-compile the flattened code.
                let flatCompiled: CompileResult;
                try {
                    flatCompiled = compileSourceString(
                        `flattened.sol`,
                        flatContents,
                        version,
                        pathRemapping,
                        [CompilationOutput.ALL],
                        compilerSettings
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

                // 5. Build the output and write it out
                const resultJSON = JSON.stringify(
                    buildOutputJSON(
                        instrCtx,
                        flatCompiled,
                        instrCtx.units,
                        modifiedFiles,
                        newSrcMap,
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
            modifiedFiles = [...instrCtx.changedUnits, utilsUnit];
            // 1. In 'files' mode first write out the files
            const newContents = instrCtx.printUnits(modifiedFiles, newSrcMap);

            // 2. For all changed files write out a `.instrumented` version of the file.
            for (const unit of instrCtx.changedUnits) {
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
                for (const unit of instrCtx.changedUnits) {
                    const instrumentedFileName = unit.absolutePath + ".instrumented";
                    const originalFileName = unit.absolutePath + ".original";

                    copy(unit.absolutePath, originalFileName, options);
                    copy(instrumentedFileName, unit.absolutePath, options);
                }
            }
        }

        if (options["instrumentation-metadata-file"] !== undefined) {
            const metadata: any = generateInstrumentationMetadata(
                instrCtx,
                newSrcMap,
                instrCtx.units,
                modifiedFiles,
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
