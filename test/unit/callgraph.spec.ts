import { ASTReader, compileSol, ContractDefinition, getABIEncoderVersion } from "solc-typed-ast";
import expect from "expect";
import { CallGraph, getCallGraph } from "../../src/instrumenter/callgraph";

describe("Call graph test", () => {
    let contracts: readonly ContractDefinition[];
    let callGraph: CallGraph;

    before("Call graph is built", () => {
        const reader = new ASTReader();
        const { data, compilerVersion } = compileSol("test/samples/cha.sol", "auto", []);

        const units = reader.read(data);
        const encVer = getABIEncoderVersion(units, compilerVersion as string);

        contracts = units.map((u) => u.vContracts).reduce((flat, next) => flat.concat(next), []);

        callGraph = getCallGraph(units, encVer);
    });

    it("Call graph is valid", () => {
        const [A, B, C, D] = contracts;

        const [A_A, A_B] = A.vFunctions;
        const [B_A, B_C] = B.vFunctions;
        const [C_D] = C.vFunctions;
        const [D_A] = D.vFunctions;

        expect(callGraph).toBeDefined();

        expect(callGraph.callers).toEqual(
            new Map([
                [A_A, new Set([])],
                [A_B, new Set([A_A, B_A, D_A])],
                [B_A, new Set([])],
                [B_C, new Set([B_A, D_A])],
                [C_D, new Set([D_A])],
                [D_A, new Set([])]
            ])
        );

        expect(callGraph.callees).toEqual(
            new Map([
                [A_A, new Set([A_B])],
                [A_B, new Set([])],
                [B_A, new Set([A_B, B_C])],
                [B_C, new Set([])],
                [C_D, new Set([])],
                [D_A, new Set([A_B, B_C, C_D])]
            ])
        );

        expect(callGraph.overrides).toEqual(
            new Map([
                [A_A, new Set([])],
                [A_B, new Set([])],
                [B_A, new Set([A_A])],
                [B_C, new Set([])],
                [C_D, new Set([])],
                [D_A, new Set([B_A])]
            ])
        );

        expect(callGraph.overridenBy).toEqual(
            new Map([
                [A_A, new Set([B_A])],
                [A_B, new Set([])],
                [B_A, new Set([D_A])],
                [B_C, new Set([])],
                [C_D, new Set([])],
                [D_A, new Set([])]
            ])
        );
    });
});
