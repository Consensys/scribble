import expect from "expect";
import { ContractDefinition } from "solc-typed-ast";
import { findExternalCalls } from "../../src/instrumenter/instrument";
import { nodeToSource } from "../../src/util";
import { getTypeCtxAndTarget, toAst } from "../integration/utils";

export type LocationDesc = [string, string | undefined];

describe("Detecting external calls Unit Tests", () => {
    const goodSamples: Array<[string, string, LocationDesc, string[]]> = [
        [
            "internal_interpose.sol",
            `pragma solidity 0.6.0;
contract Main {
    function c() public {}

    function main() public payable {
        c();
        this.c();

        function () internal fIntPtr = c;
        
        fIntPtr();
        
        function () external fExtPtr = this.c;
        
        fExtPtr();
    }
}
`,
            ["Main", undefined],
            ["this.c", "fExtPtr"]
        ],
        [
            "internal_interpose.sol",
            `pragma solidity 0.6.0;
contract Foo {
    function a() public {}
    function b() public {}
}

contract Main {
    function c() public {}

    function main() public payable {
        Foo f =  new Foo();
        
        c();
        this.c();
        f.a();
        f.b();
        
        function () external fPtr = f.a;
        
        fPtr();
        fPtr = f.b;
        fPtr();
    }
}
`,
            ["Main", undefined],
            ["this.c", "f.a", "f.b", "fPtr", "fPtr"]
        ]
    ];

    for (const [fileName, content, loc, expectedExtCalls] of goodSamples) {
        it(`Find external calls in ${loc} in #${fileName}`, () => {
            const { units } = toAst(fileName, content);

            const [ctx] = getTypeCtxAndTarget(loc, units);
            const contract: ContractDefinition = ctx[1] as ContractDefinition;
            const extCalls: string[] = findExternalCalls(contract, "0.6.0").map((call) =>
                nodeToSource(call.vExpression)
            );

            expect(extCalls).toEqual(expectedExtCalls);
        });
    }
});
