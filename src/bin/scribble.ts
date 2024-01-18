#!/usr/bin/env node
import fse from "fs-extra";
import { join, resolve } from "path";
import {
    ASTContext,
    ASTReader,
    CompilationOutput,
    CompileFailedError,
    CompileResult,
    CompilerKind,
    ContractDefinition,
    ContractKind,
    FileMap,
    FunctionDefinition,
    FunctionKind,
    FunctionStateMutability,
    InferType,
    PathOptions,
    PossibleCompilerKinds,
    Remapping,
    SourceUnit,
    SrcRangeMap,
    Statement,
    StatementWithChildren,
    VariableDeclaration,
    assert,
    compileJson,
    compileJsonData,
    compileSol,
    compileSourceString,
    downloadSupportedCompilers,
    getCompilerPrefixForOs,
    isVisiblityExternallyCallable,
    parsePathRemapping,
    bytesToString
} from "solc-typed-ast";
import { rewriteImports } from "../ast_to_source_printer";
import {
    AnnotationExtractionContext,
    AnnotationFilterOptions,
    AnnotationMap,
    AnnotationMetaData,
    AnnotationTarget,
    MacroError,
    PropertyMetaData,
    SyntaxError,
    TryAnnotationMetaData,
    UnsupportedByTargetError,
    UserConstantDefinitionMetaData,
    UserFunctionDefinitionMetaData,
    buildAnnotationMap,
    gatherContractAnnotations,
    gatherFunctionAnnotations
} from "../instrumenter/annotations";
import { getCallGraph } from "../instrumenter/callgraph";
import { CHA, getCHA } from "../instrumenter/cha";
import { AbsDatastructurePath, interposeMap } from "../instrumenter/custom_maps";
import { Warning, findDeprecatedAnnotations } from "../instrumenter/deprecated_warnings";
import {
    UnsupportedConstruct,
    instrumentContract,
    instrumentFunction,
    instrumentStatement
} from "../instrumenter/instrument";
import { AssertionMode, InstrumentationContext } from "../instrumenter/instrumentation_context";
import { instrumentStateVars } from "../instrumenter/state_var_instrumenter";
import { findStateVarUpdates } from "../instrumenter/state_vars";
import { ScribbleFactory } from "../instrumenter/utils";
import { MacroDefinition, readMacroDefinitions } from "../macros";
import { flattenUnits } from "../rewriter/flatten";
import { AnnotationType, NodeLocation } from "../spec-lang/ast";
import { STypeError, SemError, SemMap, TypeEnv, scAnnotations, tcUnits } from "../spec-lang/tc";
import {
    InstrumentationMetaData,
    Location,
    MacroFile,
    Range,
    SolFile,
    SourceFile,
    SourceMap,
    buildOutputJSON,
    dedup,
    detectProjectRoot,
    flatten,
    generateInstrumentationMetadata,
    getOr,
    isChangingState,
    isExternallyVisible,
    ppLoc,
    searchRecursive
} from "../util";
import { YamlSchemaError } from "../util/yaml";
import cli from "./scribble_cli.json";

const commandLineArgs = require("command-line-args");
const commandLineUsage = require("command-line-usage");

function error(msg: string): never {
    console.error(msg);

    process.exit(1);
}

/// TODO: Eventually make this support returning multiple lines
function getSrcLine(l: Range | Location): string {
    const startLoc = "start" in l ? l.start : l;
    const lineStart = startLoc.offset - startLoc.column;

    let lineEnd = startLoc.file.rawContents.indexOf("\n".charCodeAt(0), lineStart);

    lineEnd = lineEnd == -1 ? startLoc.file.rawContents.length : lineEnd;

    return bytesToString(startLoc.file.rawContents.slice(lineStart, lineEnd));
}

/// TODO: Eventually make this support underlining a range spanning multiple liens
function ppSrcLine(l: Range | Location): string[] {
    const startLoc = "start" in l ? l.start : l;
    const marker =
        " ".repeat(startLoc.column) +
        ("end" in l ? "^".repeat(l.end.offset - l.start.offset) : "^");

    return [ppLoc(startLoc) + ":", getSrcLine(startLoc), marker];
}

function prettyError(type: string, message: string, location: NodeLocation | Location): never {
    let primaryLoc: Location;

    if ("offset" in location) {
        primaryLoc = location;
    } else if ("start" in location) {
        primaryLoc = location.start;
    } else {
        primaryLoc = location[0].start;
    }

    const descriptionLines = [`${ppLoc(primaryLoc)} ${type}: ${message}`];

    if (location instanceof Array) {
        descriptionLines.push(
            "In macro:",
            ...ppSrcLine(location[0]),
            "Instantiated from:",
            ...ppSrcLine(location[1])
        );
    } else {
        descriptionLines.push(...ppSrcLine(location));
    }

    error(descriptionLines.join("\n"));
}

function ppWarning(warn: Warning): string[] {
    const start = "start" in warn.location ? warn.location.start : warn.location;

    return [`${ppLoc(start)} Warning: ${warn.msg}`, getSrcLine(warn.location)];
}

function assertIsFile(fileName: string, basePath: string | undefined): void {
    assert(fileName !== "", "Path is empty");
    if (basePath !== undefined) {
        fileName = join(basePath, fileName);
    }

    try {
        const stats = fse.statSync(fileName);

        assert(stats.isFile(), "Target is not a file: " + fileName);
    } catch (e: any) {
        error(e.code === "ENOENT" ? "Path not found: " + fileName : e.message);
    }
}

async function compile(
    fileNames: string[],
    type: "source" | "json",
    compilerVersion: string,
    remapping: string[],
    basePath: string | undefined,
    includePaths: string[],
    compilerSettings: any,
    compilerKind: CompilerKind
): Promise<CompileResult> {
    const astOnlyOutput = [
        CompilationOutput.AST,
        CompilationOutput.ABI,
        CompilationOutput.DEVDOC,
        CompilationOutput.USERDOC
    ];

    assert(fileNames.length > 0, "There must be at least one file to compile");

    const pathOptions: PathOptions = {
        remapping: remapping,
        basePath: basePath,
        includePath: includePaths
    };

    if (fileNames.length === 1) {
        let fileName = fileNames[0];

        if (fileName === "--") {
            const content = fse.readFileSync(0, { encoding: "utf-8" });

            fileName = "stdin";

            return type === "json"
                ? compileJsonData(
                      fileName,
                      JSON.parse(content),
                      compilerVersion,
                      astOnlyOutput,
                      compilerSettings,
                      compilerKind
                  )
                : compileSourceString(
                      fileName,
                      content,
                      compilerVersion,
                      pathOptions,
                      astOnlyOutput,
                      compilerSettings,
                      compilerKind
                  );
        }

        if (type === "json") {
            assertIsFile(fileName, basePath);

            return compileJson(
                fileName,
                compilerVersion,
                astOnlyOutput,
                compilerSettings,
                compilerKind
            );
        }
    }

    assert(type === "source", 'Multifile inputs are only allowed for "source" input mode');

    fileNames.forEach((name) => assertIsFile(name, basePath));

    return compileSol(
        fileNames,
        compilerVersion,
        pathOptions,
        astOnlyOutput,
        compilerSettings,
        compilerKind
    );
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

        if (visited.has(cur)) {
            continue;
        }

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

function detectMacroDefinitions(
    path: string,
    defs: Map<string, MacroDefinition>,
    sources: SourceMap
): void {
    const fileNames = searchRecursive(path, (fileName) => fileName.endsWith(".scribble.yaml"));

    for (const fileName of fileNames) {
        const data = fse.readFileSync(fileName);
        const macroFile = new MacroFile(fileName, data);

        sources.set(fileName, macroFile);

        readMacroDefinitions(macroFile, defs);
    }
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

            const userConsts = contractAnnot.filter(
                (annot) => annot instanceof UserConstantDefinitionMetaData
            );

            // Nothing to instrument on interfaces
            if (contract.kind === ContractKind.Interface) {
                continue;
            }

            // Nothing to do if this is a scribble-generated contract
            if (ctx.isScribbleGeneratedContract(contract)) {
                continue;
            }

            if (needsStateInvariantInstr || userFuns.length > 0 || userConsts.length > 0) {
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
                    (annot instanceof PropertyMetaData &&
                        (annot.parsedAnnot.type === AnnotationType.IfSucceeds ||
                            annot.parsedAnnot.type === AnnotationType.Require)) ||
                    annot instanceof TryAnnotationMetaData
            );

            for (const fun of contract.vFunctions) {
                // Skip functions without a body
                if (fun.vBody === undefined) {
                    continue;
                }

                let annotations = gatherFunctionAnnotations(ctx.typeEnv.inference, fun, annotMap);

                if (
                    isVisiblityExternallyCallable(fun.visibility) &&
                    fun.stateMutability !== FunctionStateMutability.Pure &&
                    fun.stateMutability !== FunctionStateMutability.View
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
            instrumentContract(
                ctx,
                annotMap,
                annotations,
                target,
                contractsNeedingInstr.has(target)
            );
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

const params = cli as any;

let options = params[1].optionList;

for (const option of options) {
    option.type = (global as any)[option.type];
}

try {
    options = commandLineArgs(params[1].optionList);
} catch (e: any) {
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

export function applyRemappings(
    remappings: Remapping[],
    path: string
): [string, string | undefined, string | undefined] {
    for (const [, prefix, mapped_prefix] of remappings) {
        if (path.startsWith(prefix)) {
            return [path.replace(prefix, mapped_prefix), prefix, mapped_prefix];
        }
    }

    return [path, undefined, undefined];
}

function copy(from: string, to: string, options: any): void {
    if (!fse.existsSync(from)) {
        error(`Unable to copy "${from}" as file or folder does not exist.`);
    }

    if (!options.quiet) {
        console.error(`Copying ${from} to ${to}`);
    }

    fse.copyFileSync(from, to);
}

function move(from: string, to: string, options: any): void {
    if (!fse.existsSync(from)) {
        error(`Unable to move "${from}" as file or folder does not exist.`);
    }

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

function isInstrumented(filePath: string, prefix: string): boolean {
    if (!fse.existsSync(filePath)) {
        return false;
    }

    const source = fse.readFileSync(filePath, { encoding: "utf-8" });

    return source.startsWith(prefix);
}

function detectCompilerKind(options: any): CompilerKind {
    const customCompilerKind = options["compiler-kind"];
    const envCompilerKind = process.env["SCRIBBLE_DEFAULT_COMPILER_KIND"];

    let kind: string;

    if (customCompilerKind) {
        kind = customCompilerKind;
    } else if (envCompilerKind) {
        kind = envCompilerKind;
    } else {
        /**
         * @see https://github.com/ethereum/solc-bin
         */
        const nativePrefixes = ["linux-amd64", "windows-amd64", "macosx-amd64"];
        const osPrefix = getCompilerPrefixForOs();

        kind =
            osPrefix !== undefined && nativePrefixes.includes(osPrefix)
                ? CompilerKind.Native
                : CompilerKind.WASM;
    }

    if (PossibleCompilerKinds.has(kind)) {
        return kind as CompilerKind;
    }

    const kinds = Array.from(PossibleCompilerKinds).join(", ");

    error(`Unsupported compiler kind "${kind}". Possible values: ${kinds}`);
}

function detectInstrMetdataFilePath(targets: string[], options: any): string {
    if (options["instrumentation-metadata-file"]) {
        return options["instrumentation-metadata-file"];
    }

    const projectRoot = detectProjectRoot(targets.map((t) => resolve(t)));

    if (projectRoot !== undefined) {
        return join(projectRoot, "instrumentation.scribble.json");
    }

    error(
        'Unable to detect project root to place instrumentation metadata file. Use "--instrumentation-metadata-file" option to explicitly specify location of the metadata file.'
    );
}

/**
 * Loads instrumentation metadata from file and validates its structure.
 *
 * @todo At some point consider to use JsonSchema validation package instead of own logic.
 */
function loadInstrMetaData(fileName: string): InstrumentationMetaData {
    let metaData: any;

    try {
        metaData = fse.readJsonSync(fileName, { encoding: "utf-8" });
    } catch (e: any) {
        error(`Unable to read instrumentation metadata file: ${e.message}`);
    }

    if (!Array.isArray(metaData.originalSourceList)) {
        error(
            `Metadata validation failed for ${fileName}: "originalSourceList" is required to be an instance of Array`
        );
    }

    if (!Array.isArray(metaData.instrSourceList)) {
        error(
            `Metadata validation failed for ${fileName}: "instrSourceList" is required to be an instance of Array`
        );
    }

    return metaData;
}

(async () => {
    const pkg = fse.readJSONSync(join(__dirname, "../../package.json"), { encoding: "utf-8" });

    if ("version" in options) {
        console.log(pkg.version);
    } else if ("download-compilers" in options) {
        const compilerKinds = options["download-compilers"].map((kind: string): CompilerKind => {
            if (PossibleCompilerKinds.has(kind)) {
                return kind as CompilerKind;
            }

            error(
                `Invalid compiler kind "${kind}". Possible values: ${[
                    ...PossibleCompilerKinds.values()
                ].join(", ")}.`
            );
        });

        console.log(
            `Downloading compilers (${compilerKinds.join(", ")}) to current compiler cache:`
        );

        for await (const compiler of downloadSupportedCompilers(compilerKinds)) {
            console.log(`${compiler.path} (${compiler.constructor.name} v${compiler.version})`);
        }
    } else if ("help" in options || !("solFiles" in options)) {
        const usage = commandLineUsage(params);

        console.log(usage);
    } else {
        const targets: string[] = options.solFiles;
        const rebasedTargets: string[] = options["base-path"]
            ? targets.map((target) => join(options["base-path"], target))
            : targets;

        const addAssert = "no-assert" in options ? false : true;

        const inputMode: "source" | "json" = oneOf(
            options["input-mode"],
            ["source", "json"],
            "Error: --input-mode must be either 'source' or 'json'"
        );

        const rawPathRemappings: string[] = options["path-remapping"]
            ? options["path-remapping"].split(";")
            : [];

        const basePath: string = options["base-path"] ? options["base-path"] : "";
        const includePaths: string[] =
            options["include-paths"] == undefined ? [] : options["include-paths"];

        const compilerVersion: string =
            options["compiler-version"] !== undefined ? options["compiler-version"] : "auto";

        const compilerKind = detectCompilerKind(options);

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

        const assertionMode: AssertionMode = oneOf(
            options["user-assert-mode"],
            ["log", "mstore", "hardhat"],
            `Error: --user-assert-mode must be "log", "mstore" or "hardhat", not ${options["user-assert-mode"]}`
        );

        const debugEvents: boolean =
            options["debug-events"] !== undefined ? options["debug-events"] : false;

        const outputMode: "flat" | "files" | "json" = oneOf(
            options["output-mode"],
            ["flat", "files", "json"],
            "Error: --output-mode must be either 'flat', 'files' or 'json'"
        );

        const metaDataFile = detectInstrMetdataFilePath(rebasedTargets, options);
        const isMetaDataFile = fse.existsSync(metaDataFile);

        const instrumentationMarker =
            "/// This file is auto-generated by Scribble and shouldn't be edited directly.\n" +
            "/// Use --disarm prior to make any changes.\n";

        /**
         * In disarm mode we don't need to instrument - just replace the instrumented files with the `.original` files
         */
        if (options["disarm"]) {
            if (!isMetaDataFile) {
                error(
                    `Unable to disarm: instrumentation metadata file "${metaDataFile}" does not exist.`
                );
            }

            const metaData = loadInstrMetaData(metaDataFile);

            const originalFiles = new Set(metaData.originalSourceList);
            const instrumentationFiles = new Set(
                metaData.instrSourceList.filter((file: string) => file !== "--")
            );

            for (const originalFileName of originalFiles) {
                if (originalFileName.endsWith(".sol.original")) {
                    move(
                        originalFileName,
                        originalFileName.replace(".sol.original", ".sol"),
                        options
                    );
                }
            }

            if (!options["keep-instrumented"]) {
                for (const instrFileName of instrumentationFiles) {
                    remove(instrFileName, options);
                }
            }

            if (isMetaDataFile) {
                remove(metaDataFile, options);
            }

            process.exit(0);
        }

        const pathRemappings = parsePathRemapping(rawPathRemappings);
        /**
         * We combine the explicitly passed-in remappings with any remappigns inferred by solc-typed-ast during compiling
         * into allRemappings. We use a map here to remove any duplicate in the inferred remappings.
         */
        const allRemappings = new Map<string, Remapping>();

        for (const remapping of pathRemappings) {
            allRemappings.set(`${remapping[0]}:${remapping[1]}:${remapping[2]}`, remapping);
        }

        let units: SourceUnit[];
        let astCtx: ASTContext;
        let compilerVersionUsed: string;
        let files: FileMap;
        let resolvedFilesMap: Map<string, string>;

        /**
         * Try to compile each target.
         */
        try {
            let targetResult: CompileResult;

            try {
                targetResult = await compile(
                    targets,
                    inputMode,
                    compilerVersion,
                    rawPathRemappings,
                    basePath,
                    includePaths,
                    compilerSettings,
                    compilerKind
                );
            } catch (e: any) {
                if (e instanceof CompileFailedError) {
                    console.error("Compile errors encountered:");

                    for (const failure of e.failures) {
                        console.error(
                            failure.compilerVersion
                                ? `SolcJS ${failure.compilerVersion}:`
                                : "Unknown compiler"
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

            for (const remapping of targetResult.inferredRemappings.values()) {
                allRemappings.set(`${remapping[0]}:${remapping[1]}:${remapping[2]}`, remapping);
            }

            compilerVersionUsed =
                targetResult.compilerVersion === undefined
                    ? compilerVersion
                    : targetResult.compilerVersion;

            assert(
                compilerVersionUsed !== "auto",
                "When passing in JSON you must specify an explicit compiler version with --compiler-version"
            );

            files = targetResult.files;
            resolvedFilesMap = targetResult.resolvedFileNames;

            assert(
                files.size > 0,
                "Missing source files in input. Did you pass in JSON without a sources entry?"
            );

            astCtx = new ASTContext();

            const reader = new ASTReader(astCtx);

            units = reader.read(targetResult.data, undefined, targetResult.files);
        } catch (e: any) {
            error(e.message);
        }

        /**
         * Check if there is an instrumentation already in-place
         */
        for (const unit of units) {
            if (isInstrumented(unit.sourceEntryKey, instrumentationMarker)) {
                error(`File "${unit.sourceEntryKey}" is already instrumented`);
            }
        }

        const contentsMap: SourceMap = new Map();

        // First load any macros if `--macro-path` was specified
        const macros = new Map<string, MacroDefinition>();

        const macroPaths: string[] = [join(__dirname, "..", "stdlib")];

        if (options["macro-path"]) {
            macroPaths.push(options["macro-path"]);
        }

        for (const macroPath of macroPaths) {
            try {
                detectMacroDefinitions(macroPath, macros, contentsMap);
            } catch (e) {
                if (e instanceof YamlSchemaError) {
                    prettyError(e.constructor.name, e.message, e.range);
                }

                throw e;
            }
        }

        // Check that merging produced sane ASTs
        for (const unit of units) {
            if (!contentsMap.has(unit.absolutePath) && files.has(unit.sourceEntryKey)) {
                const resolvedPath = resolvedFilesMap.get(unit.absolutePath);

                assert(
                    resolvedPath !== undefined,
                    `Missing resolved path for ${unit.absolutePath}`
                );

                contentsMap.set(
                    unit.absolutePath,
                    new SolFile(resolvedPath, files.get(unit.sourceEntryKey) as Uint8Array)
                );
            }
        }

        const inference = new InferType(compilerVersionUsed);

        const cha = getCHA(units);
        const callgraph = getCallGraph(inference, units);

        const annotExtractionCtx: AnnotationExtractionContext = {
            filterOptions,
            inference,
            macros
        };

        let annotMap: AnnotationMap;

        try {
            annotMap = buildAnnotationMap(units, contentsMap, annotExtractionCtx);
        } catch (e) {
            if (
                e instanceof SyntaxError ||
                e instanceof UnsupportedByTargetError ||
                e instanceof MacroError
            ) {
                prettyError(e.constructor.name, e.message, e.range.start);
            }

            throw e;
        }

        const typeEnv = new TypeEnv(inference);
        const semMap: SemMap = new Map();

        let interposingQueue: Array<[VariableDeclaration, AbsDatastructurePath]>;

        try {
            /**
             * Type check
             */
            tcUnits(units, annotMap, typeEnv);

            /**
             * Semantic check
             *
             * @todo #const should have more restrictions, not allowing certain expressions to be used.
             */
            interposingQueue = scAnnotations(annotMap, typeEnv, semMap);
        } catch (err: any) {
            if (err instanceof STypeError || err instanceof SemError) {
                prettyError("TypeError", err.message, err.loc());
            } else {
                error(`Internal error in type-checking: ${err.message}`);
            }
        }

        // If we are not outputting to stdout directly, print a summary of the
        // found annotations and warnings for things that were ignored but look like annotations
        if (!((outputMode === "flat" || outputMode === "json") && options.output === "--")) {
            const filesWithAnnots = new Set<SourceFile>();

            let nAnnots = 0;

            for (const annots of annotMap.values()) {
                for (const annot of annots) {
                    filesWithAnnots.add(annot.originalSourceFile);
                    nAnnots++;
                }
            }

            if (nAnnots === 0) {
                console.log(`Found ${nAnnots} annotations.`);
            } else {
                console.log(
                    `Found ${nAnnots} annotations in ${filesWithAnnots.size} different files.`
                );
            }

            for (const warning of findDeprecatedAnnotations(units, contentsMap, inference)) {
                console.error(ppWarning(warning).join("\n"));
            }
        }

        /**
         * Walk over the computed CHA and compute:
         *  1. The set of contracts that have contract invariants (as the map contractInvs)
         *  2. The set of contracts that NEED contract instrumentation (because they, a parent of theirs, or a child of theirs has contract invariants)
         */
        const contractsNeedingInstr = computeContractsNeedingInstr(cha, annotMap);
        const factory = new ScribbleFactory(compilerVersionUsed, astCtx);

        // Next we re-write the imports to fix broken alias references (Some
        // Solidity versions have broken references imports).
        units.forEach((sourceUnit) => {
            if (contentsMap.has(sourceUnit.absolutePath)) {
                rewriteImports(sourceUnit, contentsMap, factory);
            }
        });

        /**
         * Next try to instrument the source units
         */
        const instrCtx = new InstrumentationContext(
            factory,
            units,
            assertionMode,
            options["cov-assertions"],
            addAssert,
            callgraph,
            cha,
            filterOptions,
            dedup(flatten(annotMap.values())),
            new Map(),
            contentsMap,
            compilerVersionUsed,
            debugEvents,
            outputMode,
            typeEnv,
            semMap,
            interposingQueue
        );

        try {
            // Check that none of the map state vars to be overwritten is aliased
            for (const [stateVar] of interposingQueue) {
                instrCtx.crashIfAliased(stateVar);
            }

            instrumentFiles(instrCtx, annotMap, contractsNeedingInstr);
        } catch (e) {
            if (e instanceof UnsupportedConstruct) {
                prettyError(e.name, e.message, e.range);
            }

            throw e;
        }

        const allUnits: SourceUnit[] = [...instrCtx.units];
        const newSrcMap: SrcRangeMap = new Map();

        let modifiedFiles: SourceUnit[];

        if (outputMode === "flat" || outputMode === "json") {
            // 1. Flatten all the source files in a single SourceUnit
            const flatUnit = flattenUnits(allUnits, factory, options.output, compilerVersionUsed);

            modifiedFiles = [flatUnit];

            // 2. Print the flattened unit
            let flatContents = instrCtx
                .printUnits(modifiedFiles, newSrcMap, instrumentationMarker)
                .get(flatUnit) as string;

            flatContents = instrCtx.adjustStringLiterals(flatContents, flatUnit, 0, newSrcMap);

            // 3. If the output mode is just 'flat' we just write out the contents now.
            if (outputMode === "flat") {
                writeOut(flatContents, options.output);
            } else {
                // 4. If the output mode is 'json' we have more work - need to re-compile the flattened code.
                let flatCompiled: CompileResult;

                const pathOptions: PathOptions = {
                    remapping: rawPathRemappings,
                    basePath: basePath,
                    includePath: includePaths
                };

                try {
                    flatCompiled = await compileSourceString(
                        "flattened.sol",
                        flatContents,
                        compilerVersionUsed,
                        pathOptions,
                        [CompilationOutput.ALL],
                        compilerSettings
                    );
                } catch (e: any) {
                    if (e instanceof CompileFailedError) {
                        console.error("Compile errors encountered for flattend instrumetned file:");

                        for (const failure of e.failures) {
                            console.error(
                                failure.compilerVersion
                                    ? `SolcJS ${failure.compilerVersion}:`
                                    : "Unknown compiler"
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
                        false
                    ),
                    undefined,
                    2
                );

                writeOut(resultJSON, options.output);
            }
        } else {
            if (options["arm"] && isMetaDataFile) {
                error(
                    `Instrumentation metadata file "${metaDataFile}" already exists. Consider disarming or providing other path for instrumentation metadata file.`
                );
            }

            modifiedFiles = [...instrCtx.changedUnits];
            // 1. In 'files' mode first write out the files
            const newContents = instrCtx.printUnits(
                modifiedFiles,
                newSrcMap,
                instrumentationMarker
            );

            for (const [unit, contents] of newContents) {
                const adjustedContents = instrCtx.adjustStringLiterals(
                    contents,
                    unit,
                    modifiedFiles.indexOf(unit),
                    newSrcMap
                );

                newContents.set(unit, adjustedContents);
            }

            // 2. For all changed files write out a `.instrumented` version of the file.
            for (const unit of instrCtx.changedUnits) {
                const instrumentedFileName = instrCtx.getResolvedPath(unit) + ".instrumented";

                if (!options.quiet) {
                    console.error(`${unit.absolutePath} -> ${instrumentedFileName}`);
                }

                fse.writeFileSync(instrumentedFileName, newContents.get(unit) as string);
            }

            // 4. Finally if --arm is passed put the instrumented files in-place
            if (options["arm"]) {
                for (const unit of instrCtx.changedUnits) {
                    const unitFileName = instrCtx.getResolvedPath(unit);
                    const instrumentedFileName = unitFileName + ".instrumented";
                    const originalFileName = unitFileName + ".original";

                    copy(unitFileName, originalFileName, options);
                    copy(instrumentedFileName, unitFileName, options);
                }
            }
        }

        if (options["arm"] || options["instrumentation-metadata-file"]) {
            const metadata = generateInstrumentationMetadata(
                instrCtx,
                newSrcMap,
                instrCtx.units,
                modifiedFiles,
                options["arm"] !== undefined,
                pkg.version,
                options["output"]
            );

            writeOut(JSON.stringify(metadata, undefined, 2), metaDataFile);
            console.log(`Scribble metadata file generated.`);
        }
    }
})();
