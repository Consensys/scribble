import { spawnSync } from "child_process";
import fse from "fs-extra";
import {
    assert,
    ASTKind,
    ASTNode,
    ASTReader,
    compileJsonData,
    CompileResult,
    CompilerKind,
    compileSol,
    compileSourceString,
    ContractDefinition,
    FunctionDefinition,
    PathOptions,
    PossibleCompilerKinds,
    SourceUnit,
    Statement,
    bytesToString,
    VariableDeclaration,
    XPath
} from "solc-typed-ast";
import { AnnotationTarget, OriginalJSONLoc, single } from "../../src";
import { AnnotationType, SAnnotation, SStateVarProp } from "../../src/spec-lang/ast";
import { SScope, StateVarScope, STypingCtx } from "../../src/spec-lang/tc";

export function getCompilerKind(): CompilerKind {
    const kind = process.env["SCRIBBLE_DEFAULT_COMPILER_KIND"]
        ? process.env["SCRIBBLE_DEFAULT_COMPILER_KIND"]
        : CompilerKind.Native;

    if (PossibleCompilerKinds.has(kind)) {
        return kind as CompilerKind;
    }

    const kinds = Array.from(PossibleCompilerKinds).join(", ");

    throw new Error(`Unsupported compiler kind "${kind}". Possible values: ${kinds}`);
}

export interface ExtendedCompileResult extends CompileResult {
    compilerVersion: string;
    artefact?: string;
    units: SourceUnit[];
    reader: ASTReader;
}

export function removeProcWd(path: string): string {
    const rx = new RegExp(process.cwd() + "/", "g");

    return path.replace(rx, "");
}

export function makeArtefact(result: CompileResult): string {
    const { data, files, compilerVersion } = result;

    const artefact: any = { sources: {}, compilerVersion };

    for (const [name, entry] of Object.entries(data.sources) as Iterable<[string, any]>) {
        const source = files.get(name);

        if (source === undefined) {
            throw new Error(`Missing source for ${name} compile result`);
        }

        if ("ast" in entry && "legacyAST" in entry) {
            /**
             * No need for legacy version of AST here.
             * Better to reduce storage size of the repository.
             */
            delete entry.legacyAST;
        }

        artefact.sources[removeProcWd(name)] = { ...entry, source: bytesToString(source) };
    }

    return removeProcWd(JSON.stringify(artefact));
}

export async function toAst(fileName: string, content?: string): Promise<ExtendedCompileResult> {
    const remapping: string[] = [];
    const compilerKind = getCompilerKind();
    const opts: PathOptions = { remapping: remapping };

    const result = await (content === undefined
        ? compileSol(fileName, "auto", opts, undefined, undefined, compilerKind)
        : compileSourceString(fileName, content, "auto", opts, undefined, undefined, compilerKind));

    const compilerVersion = result.compilerVersion;

    if (compilerVersion === undefined) {
        throw new Error(`Compiler version is undefined in compile result of ${fileName}`);
    }

    const reader = new ASTReader();
    const units = reader.read(result.data, ASTKind.Any, result.files);

    return { ...result, units, reader, compilerVersion };
}

export async function toAstUsingCache(
    fileName: string,
    content?: string
): Promise<ExtendedCompileResult> {
    if (!fse.existsSync(fileName + ".json")) {
        return toAst(fileName, content);
    }

    const artefact = fileName + ".json";
    const jsonData = fse.readJSONSync(artefact, { encoding: "utf-8" });
    const compilerVersion = jsonData.compilerVersion;
    const compilerKind = getCompilerKind();

    const result = await compileJsonData(
        fileName,
        jsonData,
        compilerVersion,
        undefined,
        undefined,
        compilerKind
    );

    if (compilerVersion === undefined) {
        throw new Error(`Missing compiler version in ${artefact}`);
    }

    const reader = new ASTReader();
    const units = reader.read(result.data, ASTKind.Any, result.files);

    return { ...result, artefact, units, reader, compilerVersion };
}

/**
 * Run scribble as a subprocess and return the resulting JSON as string.
 *
 * @param fileName - filename (or list of filenames) to run scribble on
 * @param args - additional arguments
 * @returns - JSON as string
 */
export function scribble(fileName: string | string[], ...args: string[]): string {
    // Scrub DEBUG_LEVEL and DEBUG_FILTER from subprocess environment.
    const scrubbedEnv = Object.entries(process.env)
        .filter(([name]) => name !== "DEBUG_LEVEL" && name !== "DEBUG_FILTER")
        .reduce(
            (env, [key, val]) => {
                env[key] = val as string;

                return env;
            },
            {} as { [key: string]: string }
        );

    const processArgs = (fileName instanceof Array ? fileName : [fileName]).concat(args);

    // Uncomment next line to see composed scribble command:
    // console.log("scribble " + processArgs.join(" "));

    const result = spawnSync("scribble", processArgs, {
        encoding: "utf8",
        env: scrubbedEnv,
        maxBuffer: 16 * 1024 * 1024
    });

    if (result.stderr) {
        throw new Error(result.stderr);
    }

    if (result.status !== 0) {
        throw new Error(`Non-zero exit code: ${result.status}`);
    }

    return result.stdout;
}

/**
 * Wrapper around `scribble()` to run on a specific sample in our test suite.
 * It checks if a JSON artefact exists for this sample, to skip compiling, and adds known default
 * arguments needed for some samples (e.g. --macro-path for `erc20_macro.sol`)
 */
export function scrSample(fileName: string, ...additionalArgs: string[]): string {
    const artefact = fileName + ".json";
    const compilerKind = getCompilerKind();

    const args: string[] = ["--compiler-kind", compilerKind];

    if (fse.existsSync(fileName + ".json")) {
        fileName = artefact;

        const compilerVersion = fse.readJSONSync(artefact).compilerVersion;

        args.push("--input-mode", "json", "--compiler-version", compilerVersion);
    }

    args.push(...additionalArgs);

    return scribble(fileName, ...args);
}

export type LocationDesc = [string] | [string, string] | [string, string, string];

export function getTarget(loc: LocationDesc, sources: SourceUnit[]): AnnotationTarget {
    for (const unit of sources) {
        for (const contract of unit.vContracts) {
            if (contract.name === loc[0]) {
                if (loc.length === 1) {
                    return contract;
                }

                const subTarget = loc[1];

                for (const fun of contract.vFunctions) {
                    if (fun.name == subTarget) {
                        if (loc.length === 3) {
                            return single(new XPath(fun).query(loc[2])) as Statement;
                        }

                        return fun;
                    }
                }

                for (const stateVar of contract.vStateVariables) {
                    if (stateVar.name == subTarget) {
                        return stateVar;
                    }
                }

                throw new Error(
                    `Couldn't find annotation target ${subTarget} in contract ${loc[0]}`
                );
            }
        }
    }
    throw new Error(`Couldn't find contract ${loc[0]}`);
}

export function findContract(sources: SourceUnit[], contractName: string): ContractDefinition {
    for (const unit of sources) {
        for (const contract of unit.vContracts) {
            if (contract.name === contractName) {
                return contract;
            }
        }
    }

    assert(false, `Contract ${contractName} not found.`);
}

export function findContractAndFun(
    sources: SourceUnit[],
    contractName: string,
    funName: string
): [ContractDefinition, FunctionDefinition] {
    for (const unit of sources) {
        for (const contract of unit.vContracts) {
            if (contract.name === contractName) {
                for (const fun of contract.vFunctions) {
                    if (fun.name == funName) {
                        return [contract, fun];
                    }
                }
            }
        }
    }

    assert(false, `Fun ${funName} in contract ${contractName} not found.`);
}

export function findTarget(loc: LocationDesc, sources: SourceUnit[]): AnnotationTarget {
    for (const unit of sources) {
        for (const contract of unit.vContracts) {
            if (contract.name === loc[0]) {
                if (loc.length === 1) {
                    return contract;
                }

                const subTarget = loc[1];

                for (const fun of contract.vFunctions) {
                    if (fun.name == subTarget) {
                        if (loc.length === 3) {
                            const stmt = single(new XPath(fun).query(loc[2])) as Statement;
                            return stmt;
                        }

                        return fun;
                    }
                }

                for (const stateVar of contract.vStateVariables) {
                    if (stateVar.name == subTarget) {
                        return stateVar;
                    }
                }

                throw new Error(
                    `Couldn't find annotation target ${subTarget} in contract ${loc[0]}`
                );
            }
        }
    }
    throw new Error(`Couldn't find contract ${loc[0]}`);
}

function makeTypingCtx(
    scopes: SScope[],
    target: AnnotationTarget,
    type?: AnnotationType
): STypingCtx {
    if (type === undefined) {
        if (target instanceof ContractDefinition) {
            type = AnnotationType.Invariant;
        } else if (target instanceof FunctionDefinition) {
            type = AnnotationType.IfSucceeds;
        } else if (target instanceof VariableDeclaration) {
            type = AnnotationType.IfUpdated;
        } else if (target instanceof Statement) {
            type = AnnotationType.Assert;
        } else {
            assert(false, `Unknown annotation type ${type}`);
        }
    }
    return {
        scopes,
        target,
        type,
        isOld: false,
        annotation: undefined as unknown as SAnnotation,
        annotationMap: new Map()
    };
}

export function getTypeCtxAndTarget(
    loc: LocationDesc,
    sources: SourceUnit[],
    annotation?: SAnnotation
): [STypingCtx, AnnotationTarget] {
    const type: AnnotationType | undefined = annotation === undefined ? undefined : annotation.type;

    for (const unit of sources) {
        for (const contract of unit.vContracts) {
            if (contract.name === loc[0]) {
                if (loc.length === 1) {
                    return [makeTypingCtx([contract], contract, type), contract];
                }

                const subTarget = loc[1];

                for (const fun of contract.vFunctions) {
                    if (fun.name == subTarget) {
                        if (loc.length === 3) {
                            const stmt = single(new XPath(fun).query(loc[2])) as Statement;
                            return [makeTypingCtx([stmt], stmt, type), stmt];
                        }

                        return [makeTypingCtx([fun], fun, type), fun];
                    }
                }

                for (const stateVar of contract.vStateVariables) {
                    if (stateVar.name == subTarget) {
                        assert(
                            annotation instanceof SStateVarProp,
                            "Expected state variable property, got {0}",
                            annotation
                        );

                        return [
                            makeTypingCtx(
                                [contract, new StateVarScope(stateVar, annotation)],
                                stateVar,
                                type
                            ),
                            stateVar
                        ];
                    }
                }

                throw new Error(
                    `Couldn't find annotation target ${subTarget} in contract ${loc[0]}`
                );
            }
        }
    }

    throw new Error(`Couldn't find contract ${loc[0]}`);
}
/**
 * Helper function to check that 2 ASTNodes are (roughly) isomorphic. It checks that:
 *  1) They have the same tree structure (i.e. type of node at each branch, and number of children)
 *  2) Any string/int/bool properties on every node are the same
 */
export function isomorphic(a: ASTNode, b: ASTNode): boolean {
    if (a.constructor !== b.constructor) {
        return false;
    }

    const aProps = a.getFieldValues();
    const bProps = b.getFieldValues();

    assert(
        aProps.size === bProps.size,
        `Objects of the same type should have the same number of fields`
    );

    for (const [aName, aVal] of aProps.entries()) {
        if (aName === "src" || aName === "id") continue;

        const bVal = bProps.get(aName);

        if (
            (typeof aVal === "number" ||
                typeof aVal === "string" ||
                typeof aVal === "boolean" ||
                typeof aVal === "bigint") &&
            aVal !== bVal
        ) {
            return false;
        }
    }

    const aChildren = a.children;
    const bChildren = b.children;

    if (aChildren.length !== bChildren.length) {
        return false;
    }

    for (let i = 0; i < aChildren.length; i++) {
        if (!isomorphic(aChildren[i], bChildren[i])) {
            return false;
        }
    }

    return true;
}

export function loc2Src(loc: OriginalJSONLoc): string {
    return loc instanceof Array ? loc[0] : loc;
}
