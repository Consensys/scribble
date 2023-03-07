import expect from "expect";
import {
    assert,
    ASTReader,
    compileSol,
    ContractDefinition,
    FunctionDefinition,
    InferType
} from "solc-typed-ast";
import { CallGraph, getCallGraph } from "../../src/instrumenter/callgraph";

describe("Call graph test", () => {
    let contracts: readonly ContractDefinition[];
    let freeFns: readonly FunctionDefinition[];

    let callGraph: CallGraph;

    before("Call graph is built", async () => {
        const reader = new ASTReader();
        const { data, compilerVersion } = await compileSol("test/samples/cha.sol", "auto");

        assert(compilerVersion !== undefined, "Unable to detect compiler version");

        const units = reader.read(data);
        const inference = new InferType(compilerVersion);

        freeFns = units.map((u) => u.vFunctions).reduce((flat, next) => flat.concat(next), []);
        contracts = units.map((u) => u.vContracts).reduce((flat, next) => flat.concat(next), []);

        callGraph = getCallGraph(inference, units);
    });

    it("Call graph is valid", () => {
        const [plus, diff, ops] = freeFns;
        const [A, B, C, D] = contracts;

        const [A_A, A_B] = A.vFunctions;
        const [B_A, B_C] = B.vFunctions;
        const [C_D, C_E] = C.vFunctions;
        const [D_A] = D.vFunctions;

        expect(callGraph.callers).toEqual(
            new Map([
                [plus, new Set([ops, C_E])],
                [diff, new Set([ops, C_E])],
                [ops, new Set([C_E])],
                [A_A, new Set([])],
                [A_B, new Set([A_A, B_A, D_A])],
                [B_A, new Set([])],
                [B_C, new Set([B_A, D_A])],
                [C_D, new Set([D_A])],
                [C_E, new Set([])],
                [D_A, new Set([])]
            ])
        );

        expect(callGraph.callees).toEqual(
            new Map([
                [plus, new Set([])],
                [diff, new Set([])],
                [ops, new Set([plus, diff])],
                [A_A, new Set([A_B])],
                [A_B, new Set([])],
                [B_A, new Set([A_B, B_C])],
                [B_C, new Set([])],
                [C_D, new Set([])],
                [C_E, new Set([plus, diff, ops])],
                [D_A, new Set([A_B, B_C, C_D])]
            ])
        );

        expect(callGraph.overrides).toEqual(
            new Map([
                [plus, new Set([])],
                [diff, new Set([])],
                [ops, new Set([])],
                [A_A, new Set([])],
                [A_B, new Set([])],
                [B_A, new Set([A_A])],
                [B_C, new Set([])],
                [C_D, new Set([])],
                [C_E, new Set([])],
                [D_A, new Set([B_A])]
            ])
        );

        expect(callGraph.overridenBy).toEqual(
            new Map([
                [plus, new Set([])],
                [diff, new Set([])],
                [ops, new Set([])],
                [A_A, new Set([B_A])],
                [A_B, new Set([])],
                [B_A, new Set([D_A])],
                [B_C, new Set([])],
                [C_D, new Set([])],
                [C_E, new Set([])],
                [D_A, new Set([])]
            ])
        );
    });
});
