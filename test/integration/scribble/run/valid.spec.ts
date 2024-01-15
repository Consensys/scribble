import expect from "expect";
import fse from "fs-extra";
import { basename } from "path";
import { getOr, searchRecursive } from "../../../../src";
import { removeProcWd, scrSample } from "../../utils";

describe(`Command "scribble <filename>" is working properly`, () => {
    const samplesDir = "test/samples/";

    const samples = searchRecursive(samplesDir, (fileName) =>
        fileName.endsWith(".instrumented.sol")
    ).map((fileName) => removeProcWd(fileName));

    const argMap: Map<string, string[]> = new Map([
        ["contract_pos.sol", ["--debug-events", "--no-assert"]],
        ["if_assigned_complex.sol", ["--debug-events", "--no-assert"]],
        ["contract_multi_arg_debug.sol", ["--debug-events", "--no-assert"]],
        ["dbg_event_tests.sol", ["--debug-events", "--no-assert"]],
        ["macro_erc20_nested_vars.sol", ["--macro-path", "test/samples/macros"]],
        [
            "hardhat_test.sol",
            [
                "--user-assert-mode",
                "hardhat",
                "--debug-events",
                "--path-remapping",
                "hardhat/=test/samples/hardhat/",
                "--cov-assertions"
            ]
        ]
    ]);

    it(`Instrumented source samples are present in ${samplesDir}`, () => {
        expect(samples.length).toBeGreaterThan(0);
    });

    for (const instrFileName of samples) {
        const sample = instrFileName.replace(".instrumented.sol", ".sol");

        if (!fse.existsSync(sample)) {
            continue;
        }

        const args = getOr(argMap, basename(sample), []);

        describe(`scribble ${sample} ${args.join(" ")}`, () => {
            let output: string;

            before(() => {
                output = scrSample(sample, ...args);
            });

            it("STDOUT is correct", () => {
                // Uncomment next line to update instrumented sources
                // fse.writeFileSync(instrFileName, output, { encoding: "utf-8" });

                const instrSource = fse.readFileSync(instrFileName, { encoding: "utf-8" });

                expect(output).toEqual(instrSource);
            });
        });
    }
});
