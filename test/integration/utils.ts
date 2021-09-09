import { spawnSync } from "child_process";
import fse from "fs-extra";
import path from "path";
import {
    ASTKind,
    ASTNode,
    ASTReader,
    compileJsonData,
    CompileResult,
    compileSol,
    compileSourceString,
    SourceUnit,
    Statement,
    XPath
} from "solc-typed-ast";
import { AnnotationTarget, assert, single } from "../../src";
import { SAnnotation, SStateVarProp } from "../../src/spec-lang/ast";
import { StateVarScope, STypingCtx } from "../../src/spec-lang/tc";

export interface ExtendedCompileResult extends CompileResult {
    compilerVersion: string;
    artefact?: string;
    units: SourceUnit[];
    reader: ASTReader;
}

export function searchRecursive(directory: string, pattern: RegExp): string[] {
    let results: string[] = [];

    fse.readdirSync(directory).forEach((entry: string) => {
        const resolvedEntry = path.resolve(directory, entry);
        const stat = fse.statSync(resolvedEntry);

        if (stat.isDirectory()) {
            results = results.concat(searchRecursive(resolvedEntry, pattern));
        }

        if (stat.isFile() && pattern.test(resolvedEntry)) {
            results.push(resolvedEntry);
        }
    });

    return results;
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

        artefact.sources[removeProcWd(name)] = { ...entry, source };
    }

    return removeProcWd(JSON.stringify(artefact));
}

export function toAst(fileName: string, content?: string): ExtendedCompileResult {
    const remapping: string[] = [];

    const result =
        content === undefined
            ? compileSol(fileName, "auto", remapping)
            : compileSourceString(fileName, content, "auto", remapping);

    const compilerVersion = result.compilerVersion;

    if (compilerVersion === undefined) {
        throw new Error(`Compiler version is undefined in compile result of ${fileName}`);
    }

    const reader = new ASTReader();
    const units = reader.read(result.data, ASTKind.Any, result.files);

    return { ...result, units, reader, compilerVersion };
}

export function toAstUsingCache(fileName: string, content?: string): ExtendedCompileResult {
    if (!fse.existsSync(fileName + ".json")) {
        return toAst(fileName, content);
    }

    const artefact = fileName + ".json";
    const jsonData = fse.readJSONSync(artefact, { encoding: "utf-8" });
    const compilerVersion = jsonData.compilerVersion;

    const result = compileJsonData(fileName, jsonData, compilerVersion, []);

    if (compilerVersion === undefined) {
        throw new Error(`Missing compiler version in ${artefact}`);
    }

    const reader = new ASTReader();
    const units = reader.read(result.data, ASTKind.Any, result.files);

    return { ...result, artefact, units, reader, compilerVersion };
}

export function scribble(fileName: string | string[], ...args: string[]): string {
    // Scrub DEBUG_LEVEL and DEBUG_FILTER from subprocess environment.
    const scrubbedEnv = Object.entries(process.env)
        .filter(([name]) => name !== "DEBUG_LEVEL" && name !== "DEBUG_FILTER")
        .reduce((env, [key, val]) => {
            env[key] = val as string;
            return env;
        }, {} as { [key: string]: string });

    const processArgs = (fileName instanceof Array ? fileName : [fileName]).concat(args);
    const result = spawnSync("scribble", processArgs, {
        encoding: "utf8",
        env: scrubbedEnv,
        maxBuffer: 8 * 1024 * 1024
    });

    if (result.stderr) {
        throw new Error(result.stderr);
    }

    if (result.status !== 0) {
        throw new Error(`Non-zero exit code: ${result.status}`);
    }

    return result.stdout;
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

export function getTypeCtxAndTarget(
    loc: LocationDesc,
    sources: SourceUnit[],
    compilerVersion: string,
    annotation?: SAnnotation
): [STypingCtx, AnnotationTarget] {
    for (const unit of sources) {
        for (const contract of unit.vContracts) {
            if (contract.name === loc[0]) {
                if (loc.length === 1) {
                    return [[contract], contract];
                }

                const subTarget = loc[1];

                for (const fun of contract.vFunctions) {
                    if (fun.name == subTarget) {
                        if (loc.length === 3) {
                            const stmt = single(new XPath(fun).query(loc[2])) as Statement;
                            return [[stmt], stmt];
                        }

                        return [[fun], fun];
                    }
                }

                for (const stateVar of contract.vStateVariables) {
                    if (stateVar.name == subTarget) {
                        assert(annotation instanceof SStateVarProp, ``);
                        return [[contract, new StateVarScope(stateVar, annotation)], stateVar];
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
 *
 * @param a
 * @param b
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
