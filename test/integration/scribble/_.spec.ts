import { spawnSync } from "child_process";
import expect from "expect";
import fse from "fs-extra";

const cli = fse.readJSONSync("./src/bin/scribble_cli.json");

describe('Command "scribble" is working properly', () => {
    let exitCode: number | null;
    let outData: string;
    let errData: string;

    before(() => {
        const result = spawnSync("scribble", [], { encoding: "utf8" });

        outData = result.stdout;
        errData = result.stderr;
        exitCode = result.status;
    });

    describe("Command executed successfully", () => {
        it("Exit code is valid", () => {
            expect(exitCode).toEqual(0);
        });

        it("STDERR is empty", () => {
            expect(errData).toEqual("");
        });
    });

    describe("Software definition section", () => {
        const section = cli[0];

        it("Output contains header", () => {
            expect(outData).toContain(section.header);
        });

        it("Output contains description", () => {
            expect(outData).toContain(section.content);
        });
    });

    describe("Options description section", () => {
        const section = cli[1];

        it("Output contains header", () => {
            expect(outData).toContain(section.header);
        });

        for (const option of section.optionList) {
            if (option.alias) {
                it(`Output contains option "--${option.name}" with alias "-${option.alias}"`, () => {
                    expect(outData).toContain(` --${option.name} `);
                    expect(outData).toContain(` -${option.alias},`);
                });
            } else {
                it(`Output contains option "--${option.name}"`, () => {
                    expect(outData).toContain(` --${option.name} `);
                });
            }
        }
    });
});
