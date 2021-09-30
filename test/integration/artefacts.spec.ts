import expect from "expect";
import fse from "fs-extra";
import { makeArtefact, removeProcWd, searchRecursive, toAst } from "./utils";

describe("Artefacts validation", () => {
    const samplesDir = "test/samples/";
    const samples = searchRecursive(samplesDir, /(?<=\.instrumented)\.sol$/).map((fileName) =>
        removeProcWd(fileName).replace(".instrumented.sol", ".sol")
    );

    it(`Source samples are present in ${samplesDir}`, () => {
        expect(samples.length).toBeGreaterThan(0);
    });

    for (const sample of samples) {
        const artefact = sample + ".json";

        if (!fse.existsSync(artefact)) {
            continue;
        }

        it(`Artefact ${artefact} is up-to-date with ${sample}`, () => {
            const expected = makeArtefact(toAst(sample));

            // Uncomment next line to update all of the artefacts
            // fse.writeFileSync(artefact, expected);

            const stored = fse.readFileSync(artefact, { encoding: "utf-8" });

            expect(stored).toEqual(expected);
        });
    }
});
