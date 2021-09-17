import expect from "expect";
import {
    ContractDefinition,
    FunctionDefinition,
    SourceUnit,
    Statement,
    StatementWithChildren,
    StructuredDocumentation,
    VariableDeclaration
} from "solc-typed-ast";
import { assert, InstrumentationMetaData, pp } from "../../src/util";
import { removeProcWd, scribble, searchRecursive, toAstUsingCache } from "./utils";

function findPredicates(inAST: SourceUnit[]): Map<number, Set<string>> {
    const res: Map<number, Set<string>> = new Map();
    const rx =
        /\s*(if_succeeds|if_aborts|invariant|if_updated|if_assigned|assert)[a-z0-9.[\])_]*\s*({:msg\s*"([^"]*)"\s*})?\s*([^;]*);/g;

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
                preds.add((m[4] as string).trim());
            }
        }

        res.set(unit.sourceListIndex, preds);
    }

    return res;
}

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

    const samples = searchRecursive(samplesDir, /(?<=\.instrumented)\.sol$/)
        .map((fileName) => removeProcWd(fileName).replace(".instrumented.sol", ".sol"))
        .filter((fileName) => !skip.some((needle) => fileName.includes(needle)));

    const rx = /^([0-9]*):([0-9]*):([0-9]*)$/;

    const getSrcTripple = (raw: string): [number, number, number] => {
        const m = raw.match(rx);

        expect(m).not.toEqual(null);

        assert(m !== null, ``);

        const start = parseInt(m[1]);
        const len = parseInt(m[2]);
        const fileInd = parseInt(m[3]);

        return [start, len, fileInd];
    };

    it(`Source samples are present in ${samplesDir}`, () => {
        expect(samples.length).toBeGreaterThan(0);
    });

    for (const sample of samples) {
        describe(`Sample ${sample}`, () => {
            let inAst: SourceUnit[];
            let contents: string;
            let outJSON: any;

            before(() => {
                const result = toAstUsingCache(sample);

                if (!result.files.has(sample)) {
                    throw new Error(`Missing source for ${sample} in files mapping`);
                }

                inAst = result.units;
                contents = result.files.get(sample) as string;

                let fileName: string;

                const args: string[] = ["--debug-events"];

                if (result.artefact) {
                    fileName = result.artefact;

                    args.push("--input-mode", "json", "--compiler-version", result.compilerVersion);
                } else {
                    fileName = sample;
                }

                args.push("--output-mode", "json");

                outJSON = JSON.parse(scribble(fileName, ...args));
            });

            it("All predicates appear in the source map", () => {
                const preds = findPredicates(inAst);
                const instrMetadata: InstrumentationMetaData = outJSON.instrumentationMetadata;

                for (const entry of instrMetadata.propertyMap) {
                    expect(entry.filename).toEqual(sample);

                    const [start, len, fileInd] = getSrcTripple(entry.propertySource);

                    // All the test samples have a single file
                    expect(fileInd).toEqual(0);

                    let extracted = contents.slice(start, start + len).trim();

                    if (extracted.endsWith(";")) {
                        extracted = extracted.slice(0, -1);
                    }

                    const predSet = preds.get(fileInd) as Set<string>;

                    expect(predSet).not.toEqual(undefined);

                    if (!predSet.has(extracted)) {
                        assert(
                            false,
                            `Missing predicate ${extracted} in computed predicate set ${pp(
                                predSet
                            )}`
                        );
                    }
                }
            });

            it("Debug events signature looks correct-ish", () => {
                const instrMetadata: InstrumentationMetaData = outJSON.instrumentationMetadata;

                for (const propMD of instrMetadata.propertyMap) {
                    const [propStart, propLen, propFileInd] = getSrcTripple(propMD.propertySource);

                    for (const [srcLocs] of propMD.debugEventEncoding) {
                        // Check all srcLocs lie inside the annotation
                        for (const srcLoc of srcLocs) {
                            const [srcStart, srcLen, srcFileInd] = getSrcTripple(srcLoc);
                            expect(srcFileInd).toEqual(propFileInd);
                            expect(srcStart >= propStart).toBeTruthy();
                            expect(srcStart + srcLen <= propStart + propLen).toBeTruthy();
                        }
                    }
                }
            });
        });
    }
});
