import expect from "expect";
import fse from "fs-extra";
import { scribble, searchRecursive } from "../../utils";
import { basename } from "path";

describe(`Command "scribble <filename>" is working properly`, () => {
    const samplesDir = "test/samples/";
    const samples = searchRecursive(samplesDir, /(?<=\.instrumented)\.sol$/);
    const argMap: Map<string, string[]> = new Map([
        ["contract_pos.sol", ["--debug-events", "--no-assert"]]
    ]);

    it(`Instrumented source samples are present in ${samplesDir}`, () => {
        expect(samples.length).toBeGreaterThan(0);
    });

    for (const outFileName of samples) {
        const inFileName = outFileName.replace(".instrumented.sol", ".sol");

        if (!fse.existsSync(inFileName)) {
            continue;
        }

        describe(`scribble ${inFileName}`, () => {
            let outData: string;

            before(() => {
                const args = argMap.get(basename(inFileName)) || [];
                outData = scribble(inFileName, ...args);
            });

            it("STDOUT is correct", () => {
                const sampleOutput = fse.readFileSync(outFileName).toString();

                expect(outData).toEqual(sampleOutput);
            });
        });
    }
});
