import { parseExpression as parse } from "../../src/spec-lang/expr_parser";
import expect from "expect";
import { eq } from "../../src/util/struct_equality";
import { SType, SIntLiteralType, SIntType } from "../../src/spec-lang/ast";
import { SourceUnit, ContractDefinition } from "solc-typed-ast";
import { toAst } from "../integration/utils";
import { tc, STypingCtx, SemInfo, SemError, TypeMap } from "../../src/spec-lang/tc";
import { sc } from "../../src/spec-lang/tc";
import { SBoolType } from "../../src/spec-lang/ast/types/bool";
import { Logger } from "../../src/logger";
import { findFunction, findContract } from "../integration/utils";
import { SStringLiteralType } from "../../src/spec-lang/ast/types/string_literal";

export type LocationDesc = [string, string | undefined];

describe("SemanticChecker Unit Tests", () => {
    const goodSamples: Array<[string, string, Array<[string, LocationDesc, SType, SemInfo]>]> = [
        [
            "foo.sol",
            `pragma solidity 0.6.0;

            contract Foo {
                uint sV;
                int128 constant sV1 = -1;
                int32[] sI32Arr;

                function pId(int8 x) public pure returns (int8) {
                    return x;
                }

                function vId() public view returns (uint) {
                    return sV;
                }

                function add(int8 x, uint64 y) public returns (uint64 add) {
                    return uint64(x)+y;
                }
            }`,
            [
                [
                    "true",
                    ["Foo", undefined],
                    new SBoolType(),
                    { isOld: false, isConst: true, canFail: false }
                ],
                [
                    "old(true)",
                    ["Foo", undefined],
                    new SBoolType(),
                    { isOld: true, isConst: true, canFail: false }
                ],
                [
                    "1",
                    ["Foo", undefined],
                    new SIntLiteralType(),
                    { isOld: false, isConst: true, canFail: false }
                ],
                [
                    "hex'0011ff'",
                    ["Foo", undefined],
                    new SStringLiteralType(),
                    { isOld: false, isConst: true, canFail: false }
                ],
                [
                    'hex""',
                    ["Foo", undefined],
                    new SStringLiteralType(),
                    { isOld: false, isConst: true, canFail: false }
                ],
                [
                    '"abc \\" \\u0000 \\x01 Def "',
                    ["Foo", undefined],
                    new SStringLiteralType(),
                    { isOld: false, isConst: true, canFail: false }
                ],
                [
                    "''",
                    ["Foo", undefined],
                    new SStringLiteralType(),
                    { isOld: false, isConst: true, canFail: false }
                ],
                [
                    "1e10",
                    ["Foo", undefined],
                    new SIntLiteralType(),
                    { isOld: false, isConst: true, canFail: false }
                ],
                [
                    "10e+5",
                    ["Foo", undefined],
                    new SIntLiteralType(),
                    { isOld: false, isConst: true, canFail: false }
                ],
                [
                    "1000e-2",
                    ["Foo", undefined],
                    new SIntLiteralType(),
                    { isOld: false, isConst: true, canFail: false }
                ],
                [
                    "old(1)",
                    ["Foo", undefined],
                    new SIntLiteralType(),
                    { isOld: true, isConst: true, canFail: false }
                ],
                [
                    "sV",
                    ["Foo", undefined],
                    new SIntType(256, false),
                    { isOld: false, isConst: false, canFail: false }
                ],
                [
                    "sV1",
                    ["Foo", undefined],
                    new SIntType(128, true),
                    { isOld: false, isConst: true, canFail: false }
                ],
                [
                    "old(sV1)",
                    ["Foo", undefined],
                    new SIntType(128, true),
                    { isOld: true, isConst: true, canFail: false }
                ],
                [
                    "x",
                    ["Foo", "add"],
                    new SIntType(8, true),
                    { isOld: false, isConst: false, canFail: false }
                ],
                [
                    "old(x)",
                    ["Foo", "add"],
                    new SIntType(8, true),
                    { isOld: true, isConst: false, canFail: false }
                ],
                [
                    "add",
                    ["Foo", "add"],
                    new SIntType(64, false),
                    { isOld: false, isConst: false, canFail: false }
                ],
                [
                    "x+x",
                    ["Foo", "add"],
                    new SIntType(8, true),
                    { isOld: false, isConst: false, canFail: false }
                ],
                [
                    "x/x",
                    ["Foo", "add"],
                    new SIntType(8, true),
                    { isOld: false, isConst: false, canFail: true }
                ],
                [
                    "old(x % x)",
                    ["Foo", "add"],
                    new SIntType(8, true),
                    { isOld: true, isConst: false, canFail: true }
                ],
                [
                    "sI32Arr[1]",
                    ["Foo", undefined],
                    new SIntType(32, true),
                    { isOld: false, isConst: false, canFail: true }
                ],
                [
                    "old(sI32Arr[1])",
                    ["Foo", undefined],
                    new SIntType(32, true),
                    { isOld: true, isConst: false, canFail: true }
                ],
                [
                    "let x := 1 in old(x)",
                    ["Foo", undefined],
                    new SIntLiteralType(),
                    { isOld: true, isConst: true, canFail: false }
                ],
                [
                    "let x := y in x",
                    ["Foo", "add"],
                    new SIntType(64, false),
                    { isOld: false, isConst: false, canFail: false }
                ],
                [
                    "let x := old(y) in old(x)",
                    ["Foo", "add"],
                    new SIntType(64, false),
                    { isOld: true, isConst: false, canFail: false }
                ],
                [
                    "let x := old(y) in let z := 1 in old(x+z)",
                    ["Foo", "add"],
                    new SIntType(64, false),
                    { isOld: true, isConst: false, canFail: false }
                ],
                [
                    "let z := old(uint64(x)) in let x := old(y) in old(x+y)",
                    ["Foo", "add"],
                    new SIntType(64, false),
                    { isOld: true, isConst: false, canFail: false }
                ],
                [
                    "let z := old(uint64(x)) in old(let x := y in x+y)",
                    ["Foo", "add"],
                    new SIntType(64, false),
                    { isOld: true, isConst: false, canFail: false }
                ],
                [
                    "old(let x := y in x)",
                    ["Foo", "add"],
                    new SIntType(64, false),
                    { isOld: true, isConst: false, canFail: false }
                ],
                [
                    "pId(x)",
                    ["Foo", "add"],
                    new SIntType(8, true),
                    { isOld: false, isConst: false, canFail: true }
                ],
                [
                    "vId()",
                    ["Foo", "add"],
                    new SIntType(256, false),
                    { isOld: false, isConst: false, canFail: true }
                ],
                [
                    "$result",
                    ["Foo", "add"],
                    new SIntType(64, false),
                    { isOld: false, isConst: false, canFail: false }
                ]
            ]
        ]
    ];

    const badSamples: Array<[string, string, Array<[string, LocationDesc]>]> = [
        [
            "foo.sol",
            `pragma solidity 0.6.0;

            contract Foo {
                uint sV;
                int128 constant sV1 = -1;
                int32 sI32Arr;

                function vId() public returns (uint) {
                    return sV;
                }

                function add(uint8 x, uint64 y) public returns (uint64 add) {
                    return uint64(x)+y;
                }
            }`,
            [
                ["old(old(x))", ["Foo", "add"]],
                ["let x := y in old(x)", ["Foo", "add"]],
                ["let x := y in let z := old(1) in old(x+z)", ["Foo", "add"]],
                ["vId()", ["Foo", "add"]],
                ["old($result)", ["Foo", "add"]]
            ]
        ]
    ];

    for (const [fileName, content, testCases] of goodSamples) {
        describe(`Positive tests for #${fileName}`, () => {
            let sources: SourceUnit[];

            before(() => {
                [sources] = toAst(fileName, content);
            });

            for (const [specString, loc, expectedType, expectedInfo] of testCases) {
                it(`SemCheck for ${specString} returns ${JSON.stringify(expectedInfo)}`, () => {
                    const parsed = parse(specString);
                    const ctx: STypingCtx = [sources, findContract(loc[0], sources)];
                    if (loc[1] !== undefined) {
                        ctx.push(findFunction(loc[1], ctx[1] as ContractDefinition));
                    }
                    const typing: TypeMap = new Map();
                    const type = tc(parsed, ctx, typing);
                    expect(eq(type, expectedType)).toEqual(true);
                    const semInfo = sc(parsed, { isOld: false }, typing);
                    Logger.debug(`[${parsed.pp()}] sem info: ${JSON.stringify(semInfo)}`);
                    expect(eq(semInfo, expectedInfo)).toEqual(true);
                });
            }
        });
    }

    for (const [fileName, content, testCases] of badSamples) {
        describe(`Negative tests for #${fileName}`, () => {
            let sources: SourceUnit[];

            before(() => {
                [sources] = toAst(fileName, content);
            });

            for (const [specString, loc] of testCases) {
                it(`SemCheck for ${specString} throws SemError`, () => {
                    const parsed = parse(specString);
                    const ctx: STypingCtx = [sources, findContract(loc[0], sources)];
                    if (loc[1] !== undefined) {
                        ctx.push(findFunction(loc[1], ctx[1] as ContractDefinition));
                    }
                    // Type-checking should succeed
                    const typing: TypeMap = new Map();
                    tc(parsed, ctx, typing);
                    expect(sc.bind(sc, parsed, { isOld: false }, typing)).toThrowError(
                        SemError as any
                    );
                });
            }
        });
    }
});
