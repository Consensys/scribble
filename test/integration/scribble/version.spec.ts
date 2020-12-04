import { spawnSync } from "child_process";
import expect from "expect";

describe('Command "scribble --version" is working properly', () => {
    let exitCode: number | null;
    let outData: string;
    let errData: string;

    before(() => {
        const result = spawnSync("scribble", ["--version"], { encoding: "utf8" });

        outData = result.stdout;
        errData = result.stderr;
        exitCode = result.status;
    });

    it("Exit code is valid", () => {
        expect(exitCode).toEqual(0);
    });

    it("STDERR is empty", () => {
        expect(errData).toEqual("");
    });

    it("STDOUT is correct", () => {
        expect(outData).toMatch(/\d+.\d+.\d+/);
    });
});
