import expect from "expect";
import fse from "fs-extra";
import {
    assert,
    ContractDefinition,
    stringToBytes,
    FunctionDefinition,
    SourceUnit,
    Statement,
    StatementWithChildren,
    StructuredDocumentation,
    bytesToString,
    VariableDeclaration
} from "solc-typed-ast";
import { getOr, InstrumentationMetaData, searchRecursive } from "../../src/util";
import { loc2Src, removeProcWd, scrSample, toAstUsingCache } from "./utils";
import YAML from "yaml";
import { basename } from "path";

function findPredicates(
    inAST: SourceUnit[],
    instrMetadata: InstrumentationMetaData
): Map<number, Set<string>> {
    const res: Map<number, Set<string>> = new Map();
    const rx =
        /\s*(if_succeeds|if_aborts|invariant|if_updated|if_assigned|assert|try|require|macro)[a-z0-9.[\])_]*\s*({:msg\s*"([^"]*)"\s*}|"([^"]*)")?\s*(.*);/g;

    for (const unit of inAST) {
        const targets: Array<VariableDeclaration | FunctionDefinition | ContractDefinition> =
            unit.getChildrenBySelector(
                (node) =>
                    node instanceof ContractDefinition ||
                    node instanceof FunctionDefinition ||
                    node instanceof VariableDeclaration ||
                    node instanceof Statement ||
                    node instanceof StatementWithChildren
            );

        const preds = new Set<string>();

        for (const target of targets) {
            if (target.documentation === undefined) {
                continue;
            }

            const text =
                target.documentation instanceof StructuredDocumentation
                    ? target.documentation.text
                    : target.documentation;

            let m: RegExpExecArray | null;

            while ((m = rx.exec(text)) !== null) {
                preds.add((m[5] as string).trim());
            }
        }

        const ind = instrMetadata.originalSourceList.indexOf(unit.sourceEntryKey);
        assert(ind !== -1, `Missing ${unit.sourceEntryKey} from original sources`);
        res.set(ind, preds);
    }

    for (let i = 0; i < instrMetadata.originalSourceList.length; i++) {
        const fileName = instrMetadata.originalSourceList[i];

        if (!(fileName.endsWith(".yaml") || fileName.endsWith(".yml"))) {
            continue;
        }

        const json = YAML.parse(fse.readFileSync(fileName, { encoding: "utf8" }));
        const macroPreds = new Set<string>();

        for (const macroBody of Object.values<any>(json)) {
            for (const props of Object.values<any>(macroBody.properties)) {
                for (const prop of props) {
                    macroPreds.add(prop.prop);
                }
            }
        }

        res.set(i, macroPreds);
    }

    return res;
}

const rxSrc = /^([0-9]*):([0-9]*):([0-9]*)$/;

function getSrcTripple(raw: string): [number, number, number] {
    const m = raw.match(rxSrc);

    assert(m !== null, "Expected regexp {0} to match string {1}", rxSrc.source, raw);

    const start = parseInt(m[1]);
    const len = parseInt(m[2]);
    const fileInd = parseInt(m[3]);

    return [start, len, fileInd];
}

const rxEmitEventLocation =
    /(emit )?__ScribbleUtilsLib__([0-9]*).[Aa]ssertionFailed\((unicode)?"([0-9]*:[0-9]*:[0-9]*) ([0-9]*).*"\)/;

const rxEmitEventData =
    /(emit )?__ScribbleUtilsLib__([0-9]*).[Aa]ssertionFailedData\(([0-9]*), abi.encode\(.*\)\)/;

const rxConsoleLogLocation = /console\.logString\((unicode)?"([0-9]*:[0-9]*:[0-9]*) ([0-9]*).*"\)/;

const rxConsoleLogData = /console\.log[a-zA-Z0-9]+\(.+\)/;

describe("Property map test", () => {
    const samplesDir = "test/samples/";

    /**
     * This test is hacky - it finds the expected set of predicates using a
     * regex that only supports single-line invariant with no semicolons in
     * strings. So we need to skip any files with multiline invariants, or
     * invariants with a semicolon in string literals.
     */
    const skip = [
        "increment_multiline.sol",
        "semicolon_in_string.sol",
        "increment_inherited_collision.sol"
    ];

    const argMap = new Map<string, string[]>([
        ["macro_erc20_nested_vars.sol", ["--macro-path", "test/samples/macros"]],
        [
            "hardhat_test.sol",
            ["--user-assert-mode", "hardhat", "--path-remapping", "hardhat/=test/samples/hardhat/"]
        ]
    ]);

    const samples = searchRecursive(samplesDir, (fileName) =>
        fileName.endsWith(".instrumented.sol")
    )
        .map((fileName) => removeProcWd(fileName).replace(".instrumented.sol", ".sol"))
        .filter((fileName) => !skip.some((needle) => fileName.includes(needle)));

    it(`Source samples are present in ${samplesDir}`, () => {
        expect(samples.length).toBeGreaterThan(0);
    });

    for (const sample of samples) {
        describe(sample, () => {
            let inAst: SourceUnit[];
            let outJSON: any;

            before(async () => {
                const result = await toAstUsingCache(sample);

                if (!result.files.has(sample)) {
                    throw new Error(`Missing source for ${sample} in files mapping`);
                }

                inAst = result.units;

                outJSON = JSON.parse(
                    scrSample(
                        sample,
                        "--debug-events",
                        "--output-mode",
                        "json",
                        ...getOr(argMap, basename(sample), [])
                    )
                );
            });

            it("All predicates appear in the source map", async () => {
                const instrMetadata: InstrumentationMetaData = outJSON.instrumentationMetadata;
                const preds = findPredicates(inAst, instrMetadata);

                for (const entry of instrMetadata.propertyMap) {
                    expect(entry.filename).toEqual(sample);

                    const [start, len, fileInd] = getSrcTripple(loc2Src(entry.propertySource));

                    // All the test samples have a single file
                    expect(fileInd).toBeLessThan(instrMetadata.originalSourceList.length);

                    const fileName = instrMetadata.originalSourceList[fileInd];

                    // Skip instantiated macros as they won't match exactly with the
                    // original due to variable renaming
                    if (fileName.endsWith(".yaml") || fileName.endsWith(".yml")) {
                        continue;
                    }

                    const contents = await fse.readFile(fileName);

                    let extracted = bytesToString(contents.slice(start, start + len)).trim();

                    if (extracted.endsWith(";")) {
                        extracted = extracted.slice(0, -1);
                    }

                    const predSet = preds.get(fileInd) as Set<string>;

                    expect(predSet).not.toEqual(undefined);

                    if (!predSet.has(extracted)) {
                        assert(
                            false,
                            "Missing predicate {0} in computed predicate set {1}",
                            extracted,
                            predSet
                        );
                    }
                }
            });

            it("Debug events signature looks correct-ish", () => {
                const instrMetadata: InstrumentationMetaData = outJSON.instrumentationMetadata;

                for (const propMD of instrMetadata.propertyMap) {
                    const [propStart, propLen, propFileInd] = getSrcTripple(
                        loc2Src(propMD.propertySource)
                    );

                    for (const [, srcLocs] of propMD.debugEventEncoding) {
                        // Check all srcLocs lie inside the annotation
                        for (const srcLoc of srcLocs) {
                            const [srcStart, srcLen, srcFileInd] = getSrcTripple(loc2Src(srcLoc));

                            expect(srcFileInd).toEqual(propFileInd);
                            expect(srcStart >= propStart).toBeTruthy();
                            expect(srcStart + srcLen <= propStart + propLen).toBeTruthy();
                        }
                    }
                }
            });

            it("Assertion messages contain a correct source location", () => {
                const instrMetadata: InstrumentationMetaData = outJSON.instrumentationMetadata;
                for (const propMD of instrMetadata.propertyMap) {
                    for (const assertionRng of propMD.assertionRanges) {
                        const [start, len, fileInd] = getSrcTripple(assertionRng);

                        // All the test samples have a single file
                        expect(fileInd).toBe(0);
                        expect(instrMetadata.instrSourceList[fileInd]).toBe("--");

                        const contents = stringToBytes(outJSON.sources["flattened.sol"]["source"]);
                        const extracted = bytesToString(contents.slice(start, start + len)).trim();

                        if (extracted === "assert(false)") {
                            continue;
                        }

                        let m = extracted.match(rxEmitEventLocation);

                        if (m) {
                            const strSrcRange = m[4];
                            const [srcStart, srcLen, srcFileInd] = getSrcTripple(strSrcRange);

                            expect(start).toEqual(srcStart);
                            expect(len).toEqual(srcLen);
                            expect(fileInd).toEqual(srcFileInd);

                            continue;
                        }

                        m = extracted.match(rxEmitEventData);

                        if (m) {
                            continue;
                        }

                        m = extracted.match(rxConsoleLogLocation);

                        if (m) {
                            const strSrcRange = m[2];
                            const [srcStart, srcLen, srcFileInd] = getSrcTripple(strSrcRange);

                            expect(start).toEqual(srcStart);
                            expect(len).toEqual(srcLen);
                            expect(fileInd).toEqual(srcFileInd);

                            continue;
                        }

                        m = extracted.match(rxConsoleLogData);

                        if (m) {
                            continue;
                        }

                        assert(false, `Unexpected assertion: ${extracted}`);
                    }
                }
            });
        });
    }
});
