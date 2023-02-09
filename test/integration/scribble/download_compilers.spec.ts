import { spawnSync } from "child_process";
import expect from "expect";

describe('Command "scribble --download-compilers native wasm" is working properly', () => {
    let exitCode: number | null;
    let outData: string;
    let errData: string;

    before(() => {
        const result = spawnSync("scribble", ["--download-compilers", "native", "wasm"], {
            encoding: "utf8"
        });

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
        const lines = outData.trimEnd().split("\n");
        const header = lines.shift();

        expect(header).toEqual("Downloading compilers (native, wasm) to current compiler cache:");

        for (const line of lines) {
            expect(line).toMatch(/\((NativeCompiler|WasmCompiler) v\d+\.\d+\.\d+\)$/);
        }
    });
});
