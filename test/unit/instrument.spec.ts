import expect from "expect";
import { SourceUnit, ContractDefinition, ASTReader } from "solc-typed-ast";
import { getTypeCtx, toAst } from "../integration/utils";
import { findExternalCalls } from "../../src/instrumenter/instrument";
import { nodeToSource } from "../../src/util";

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
            const [sources]: [SourceUnit[], ASTReader, Map<string, string>, string] = toAst(
                fileName,
                content
            );

            const ctx = getTypeCtx(loc, sources);
            const contract: ContractDefinition = ctx[1] as ContractDefinition;
            const extCalls: string[] = findExternalCalls(contract).map((call) =>
                nodeToSource(call.vExpression)
            );
            expect(extCalls).toEqual(expectedExtCalls);
        });
    }
});
