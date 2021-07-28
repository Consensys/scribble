import expect from "expect";
import fse from "fs-extra";
import { removeProcWd, scribble, searchRecursive } from "../../utils";
import { basename } from "path";

describe(`Command "scribble <filename>" is working properly`, () => {
    const samplesDir = "test/samples/";
    const samples = searchRecursive(samplesDir, /(?<=\.instrumented)\.sol$/).map((fileName) =>
        removeProcWd(fileName)
    );

    const argMap: Map<string, string[]> = new Map([
        ["contract_pos.sol", ["--debug-events", "--no-assert"]],
        ["if_assigned_complex.sol", ["--debug-events", "--no-assert"]],
        ["contract_multi_arg_debug.sol", ["--debug-events", "--no-assert"]],
        ["dbg_event_tests.sol", ["--debug-events", "--no-assert"]]
    ]);

    it(`Instrumented source samples are present in ${samplesDir}`, () => {
        expect(samples.length).toBeGreaterThan(0);
    });

    for (const instrFileName of samples) {
        const sample = instrFileName.replace(".instrumented.sol", ".sol");

        if (!fse.existsSync(sample)) {
            continue;
        }

        let fileName: string;

        const artefactFileName = sample + ".json";
        const args: string[] = [];

        if (fse.existsSync(artefactFileName)) {
            fileName = artefactFileName;

            const artefact = fse.readJSONSync(artefactFileName);

            args.push("--input-mode", "json", "--compiler-version", artefact.compilerVersion);
        } else {
            fileName = sample;
        }

        const mappedArgs = argMap.get(basename(sample));

        if (mappedArgs) {
            args.push(...mappedArgs);
        }

        describe(`scribble ${fileName} ${args.join(" ")}`, () => {
            let output: string;

            before(() => {
                output = scribble(fileName, ...args);
            });

            it("STDOUT is correct", () => {
                const instrSource = fse.readFileSync(instrFileName, { encoding: "utf-8" });

                expect(output).toEqual(instrSource);
            });
        });
    }
});
