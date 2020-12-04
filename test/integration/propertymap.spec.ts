import {
    SourceUnit,
    StructuredDocumentation,
    VariableDeclaration,
    FunctionDefinition,
    ContractDefinition
} from "solc-typed-ast";
import expect from "expect";
import fse from "fs-extra";
import { toAst, searchRecursive } from "./utils";
import { scribble } from "./utils";
import { assert } from "../../src/util/misc";

function findPredicates(inAST: SourceUnit[]): Map<number, Set<string>> {
    const res: Map<number, Set<string>> = new Map();
    const rx = /\s*(if_succeeds|if_aborts|invariant)\s*({:msg\s*"([^"]*)"\s*})?\s*([^;]*);/g;

    for (const unit of inAST) {
        const targets: Array<VariableDeclaration | FunctionDefinition | ContractDefinition> = [];
        const preds: Set<string> = new Set();

        targets.push(...unit.getChildrenByType(ContractDefinition));
        targets.push(...unit.getChildrenByType(FunctionDefinition));
        targets.push(...unit.getChildrenByType(VariableDeclaration));
        for (const target of targets) {
            if (target.documentation === undefined) {
                continue;
            }

            const text: string =
                target.documentation instanceof StructuredDocumentation
                    ? target.documentation.text
                    : target.documentation;

            let m;

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
    const skip = ["increment_multiline.sol", "semicolon_in_string.sol"];
    const samples = searchRecursive(samplesDir, /(?<=\.instrumented)\.sol$/)
        .map((fileName) => fileName.replace(".instrumented.sol", ".sol"))
        .filter((x) => {
            for (const needle of skip) {
                if (x.includes(needle)) {
                    return false;
                }
            }

            return true;
        });
    const rx = /^([0-9]*):([0-9]*):([0-9]*)$/;

    it(`Source samples are present in ${samplesDir}`, () => {
        expect(samples.length).toBeGreaterThan(0);
    });

    for (const fileName of samples) {
        describe(`Sample ${fileName}`, () => {
            let inAst: SourceUnit[];
            let contents: string;
            let outJSON: any;

            before(() => {
                contents = fse.readFileSync(fileName, { encoding: "utf8" });
                [inAst] = toAst(fileName, contents);
                outJSON = JSON.parse(scribble(fileName, "--output-mode", "json"));
            });

            it("All predicates appear in the source map", () => {
                const preds = findPredicates(inAst);
                for (const entry of outJSON.propertyMap) {
                    expect(entry.filename).toEqual(fileName);
                    const m = (entry.propertySource as string).match(rx);
                    expect(m).not.toEqual(null);
                    assert(m !== null, ``);
                    const start = parseInt(m[1]);
                    const len = parseInt(m[2]);
                    const fileInd = parseInt(m[3]);

                    // All the test samples have a single file
                    expect(fileInd).toEqual(0);

                    let extracted = contents.slice(start, start + len).trim();
                    if (extracted.endsWith(";")) extracted = extracted.slice(0, -1);

                    const predSet = preds.get(fileInd);
                    expect(predSet).not.toEqual(undefined);
                    expect((predSet as any).has(extracted)).toEqual(true);
                }
            });
        });
    }
});
