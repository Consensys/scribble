import expect from "expect";
import fse from "fs-extra";
import { searchRecursive } from "./utils";
import { scribble } from "./utils";
import { join } from "path";

describe("Multiple-file project instrumentation", () => {
    const samples: Array<[string, string[]]> = [
        ["test/multifile_samples/proj1", ["child1.sol", "child2.sol"]],
        [
            "test/multifile_samples/import_rewrites",
            ["main.sol", "imp1.sol", "imp2.sol", "imp3.sol"]
        ],
        ["test/multifile_samples/inheritance1", ["C.sol", "D.sol"]]
    ];

    for (const [dirName, solFiles] of samples) {
        describe(`Multi-file Sample ${dirName}`, () => {
            const solPaths: string[] = solFiles.map((name) => join(dirName, name));
            let expectedInstrumented: Map<string, string>;
            let expectedFlat: string;
            let expectedPropertyMap: any;

            before(() => {
                const expectedInstrumentedFiles = searchRecursive(
                    dirName,
                    /.+\.sol.instrumented.expected$/
                );
                expectedInstrumented = new Map(
                    expectedInstrumentedFiles.map((fileName) => [
                        fileName,
                        fse.readFileSync(fileName, "utf-8")
                    ])
                );
                expectedFlat = fse.readFileSync(`${dirName}/flat.sol.expected`, "utf-8");
                expectedPropertyMap = JSON.parse(
                    fse.readFileSync(`${dirName}/propertyMap.json.expected`, "utf-8")
                );
            });

            it("Flat mode is correct", () => {
                const actualFlat = scribble(solPaths, "-o", "--", "--compiler-version", "0.6.11");
                expect(actualFlat).toEqual(expectedFlat);
            });

            it("Instrumented files are correct", () => {
                scribble(
                    solPaths,
                    "--output-mode",
                    "files",
                    "--quiet",
                    "--compiler-version",
                    "0.6.11"
                );
                for (const [fileName, expectedContents] of expectedInstrumented) {
                    const atualInstr = fse.readFileSync(
                        fileName.replace(".sol.instrumented.expected", ".sol.instrumented"),
                        "utf-8"
                    );
                    expect(atualInstr).toEqual(expectedContents);
                }
            });

            it("JSON mode is correct", () => {
                const actualJsonStr = scribble(
                    solPaths,
                    "-o",
                    "--",
                    "--output-mode",
                    "json",
                    "--compiler-version",
                    "0.6.11"
                );
                const actualJson = JSON.parse(actualJsonStr);
                expect(actualJson.propertyMap).toEqual(expectedPropertyMap.propertyMap);
            });

            it("In-place arming works", () => {
                scribble(
                    solPaths,
                    "--output-mode",
                    "files",
                    "--quiet",
                    "--arm",
                    "--compiler-version",
                    "0.6.11"
                );
                for (const [fileName, expectedContents] of expectedInstrumented) {
                    const atualInstr = fse.readFileSync(
                        fileName.replace(".sol.instrumented.expected", ".sol"),
                        "utf-8"
                    );
                    expect(atualInstr).toEqual(expectedContents);

                    const originalFileName = fileName.replace(
                        ".sol.instrumented.expected",
                        ".sol.original"
                    );

                    expect(fse.existsSync(originalFileName)).toEqual(true);
                }
            });

            it("In-place dis-arming works", () => {
                scribble(
                    solPaths,
                    "--output-mode",
                    "files",
                    "--quiet",
                    "--disarm",
                    "--compiler-version",
                    "0.6.11"
                );
                for (const [fileName, expectedContents] of expectedInstrumented) {
                    const instrFileName = fileName.replace(
                        ".sol.instrumented.expected",
                        ".sol.instrumented"
                    );

                    const atualInstr = fse.readFileSync(
                        fileName.replace(".sol.instrumented.expected", ".sol"),
                        "utf-8"
                    );
                    expect(atualInstr).not.toEqual(expectedContents);
                    expect(fse.existsSync(instrFileName)).toEqual(false);

                    const originalFileName = fileName.replace(
                        ".sol.instrumented.expected",
                        ".sol.original"
                    );

                    expect(fse.existsSync(originalFileName)).toEqual(false);
                }
            });
        });
    }
});
