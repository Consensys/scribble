import { ASTReader, compileSol, ContractDefinition } from "solc-typed-ast";
import expect from "expect";
import { CHA, getCHA } from "../../src/instrumenter/cha";

describe("Contract hierarchy test", () => {
    let contracts: readonly ContractDefinition[];
    let cha: CHA<ContractDefinition>;

    before("CHA is built", async () => {
        const reader = new ASTReader();
        const { data } = await compileSol("test/samples/cha.sol", "auto");

        const units = reader.read(data);

        contracts = units.map((u) => u.vContracts).reduce((flat, next) => flat.concat(next), []);

        cha = getCHA(units);
    });

    it("CHA is valid", () => {
        const [A, B, C, D, E] = contracts;

        expect(cha).toBeDefined();

        expect(cha.roots).toEqual(new Set([A, C]));
        expect(cha.leaves).toEqual(new Set([D, E]));

        expect(cha.parents).toEqual(
            new Map([
                [A, []],
                [B, [A]],
                [C, []],
                [D, [B, C]],
                [E, [B]]
            ])
        );

        expect(cha.children).toEqual(
            new Map([
                [A, new Set([B])],
                [B, new Set([D, E])],
                [C, new Set([D])],
                [D, new Set([])],
                [E, new Set([])]
            ])
        );
    });
});
