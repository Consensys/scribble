import expect from "expect";
import { InferType } from "solc-typed-ast";
import { findExternalCalls } from "../../src/instrumenter/instrument";
import { nodeToSource } from "../../src/util";
import { findContract, LocationDesc, toAst } from "../integration/utils";

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
            ["Main"],
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
            ["Main"],
            ["this.c", "f.a", "f.b", "fPtr", "fPtr"]
        ]
    ];

    for (const [fileName, content, loc, expectedExtCalls] of goodSamples) {
        it(`Find external calls in ${loc} in #${fileName}`, async () => {
            const compilerVersion = "0.6.0";
            const inference = new InferType(compilerVersion);
            const { units } = await toAst(fileName, content);

            const contract = findContract(units, loc[0]);
            const extCalls: string[] = findExternalCalls(contract, inference).map((call) =>
                nodeToSource(call.vExpression)
            );

            expect(extCalls).toEqual(expectedExtCalls);
        });
    }
});
