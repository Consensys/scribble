import {
    AddressType,
    ArrayType,
    BoolType,
    BytesType,
    ContractDefinition,
    DataLocation,
    EnumDefinition,
    FixedBytesType,
    FunctionStateMutability,
    FunctionType,
    FunctionVisibility,
    IntLiteralType,
    IntType,
    PointerType,
    SourceUnit,
    StringLiteralType,
    StringType,
    StructDefinition,
    TupleType,
    TypeNameType,
    TypeNode,
    UserDefinedType,
    UserDefinition
} from "solc-typed-ast";
import expect from "expect";
import { Logger } from "../../src/logger";
import { SUserFunctionDefinition, SId } from "../../src/spec-lang/ast";
import { parseAnnotation, parseExpression as parse } from "../../src/spec-lang/expr_parser";
import { tc, tcAnnotation, TypeEnv } from "../../src/spec-lang/tc";
import { eq } from "../../src/util/struct_equality";
import { getTarget, getTypeCtxAndTarget, toAst } from "../integration/utils";
import { assert, pp } from "../../src/util";

export type LocationDesc = [string, string | undefined];

function findTypeDef(name: string, units: SourceUnit[]): UserDefinition {
    for (const unit of units) {
        for (const child of unit.getChildrenBySelector(
            (child) =>
                (child instanceof ContractDefinition ||
                    child instanceof StructDefinition ||
                    child instanceof EnumDefinition) &&
                child.name === name
        )) {
            return child as UserDefinition;
        }
    }
    assert(false, ``);
}

describe("TypeChecker Expression Unit Tests", () => {
    const goodSamples: Array<
        [
            string,
            string,
            Array<[string, LocationDesc, TypeNode | ((arg: SourceUnit[]) => TypeNode)]>
        ]
    > = [
        [
            "foo.sol",
            `pragma solidity 0.6.0;

            enum GlobalEnum {
                A,
                B,
                C
            }
            
            library Lib {
                function ladd(uint32 a, uint32 b) public returns (uint32) {
                    return a+b;
                }
            }

            library Lib2 {
                function foo(int128 x) public returns (bool) {
                    return true;
                }

                function balanceOf(address x) internal pure returns (uint) {
                    return 123;
                }

                function balanceOf2(Foo x) internal pure returns (uint) {
                    return 123;
                }
            }

            library Lib3 {
                function len(string memory s) public returns (uint) {
                    return bytes(s).length;
                }
            }

            interface IFace {
                function imoo(int8 d, int16 e) external returns (address, string memory);
            }

            contract Boo {
                uint a;
                int8 public s;
                string str;

                enum BooEnum {
                    G,
                    H,
                    I
                }

                function foo(uint x) public returns (uint) {
                    return x;
                }
            }

            contract Foo {
                uint sV;
                int128 sV1;
                address sA;
                address payable sA1;
                bool sB;

                string sS;
                bytes sBy;
                uint[] sUArr;
                uint[5] sUFixedArr;
                int64[] sI64Arr;
                uint8[][] sNestedArr;
                bytes32 sFB32;
                bytes16 sFB16;
                uint32 u32a;
                uint32 u32b;
                using Lib for uint32;
                using Lib2 for *;
                using Lib3 for string;

                enum FooEnum {
                    D,
                    E,
                    F
                }

                struct SFoo {
                    uint x;
                    address a;
                    string s;
                }

                struct SMoo {
                    SFoo foo;
                }

                struct Goo {
                    bytes f1;
                    bytes f2;
                }

                Goo[] goos;

                SFoo sFoo;
                SMoo sMoo;
                Boo sBoo;

                mapping (uint32 => int64) sM;

                function add(int8 x, uint64 y) public returns(uint64 add) {
                    return uint64(x) + y;
                }

                function foo(uint[] memory mUArr, bytes memory mBy, string memory mS) public {
                }

                function idPair(uint x, uint y) public returns (uint, uint) {
                    return (x,y);
                }
            }`,
            [
                ["uint", ["Foo", undefined], new TypeNameType(new IntType(256, false))],
                ["int24", ["Foo", undefined], new TypeNameType(new IntType(24, true))],
                ["byte", ["Foo", undefined], new TypeNameType(new FixedBytesType(1))],
                ["bytes3", ["Foo", undefined], new TypeNameType(new FixedBytesType(3))],
                ["string", ["Foo", undefined], new TypeNameType(new StringType())],
                ["address payable", ["Foo", undefined], new TypeNameType(new AddressType(true))],
                ["true", ["Foo", undefined], new BoolType()],
                ["1", ["Foo", undefined], new IntLiteralType()],
                ["hex'0011ff'", ["Foo", undefined], new StringLiteralType("0011ff", true)],
                ['hex""', ["Foo", undefined], new StringLiteralType("", true)],
                [
                    '"abc \\" \\u0000 \\x01 Def "',
                    ["Foo", undefined],
                    new StringLiteralType('abc " \u0000 \x01 Def ', false)
                ],
                ["''", ["Foo", undefined], new StringLiteralType("", false)],
                ["1e10", ["Foo", undefined], new IntLiteralType()],
                ["10e+5", ["Foo", undefined], new IntLiteralType()],
                ["1000e-2", ["Foo", undefined], new IntLiteralType()],
                [
                    "0xAaaaAaAAaaaAAaAAaAaaaaAAAAAaAaaaAaAaaAA0",
                    ["Foo", undefined],
                    new AddressType(true)
                ],
                [
                    "0xAaaaAaAAaaaAAaAAaAaaaaAAAAAaAaaaAaAaaAA0.balance",
                    ["Foo", undefined],
                    new IntType(256, false)
                ],
                ["sV", ["Foo", undefined], new IntType(256, false)],
                ["sV1", ["Foo", undefined], new IntType(128, true)],
                ["sA", ["Foo", undefined], new AddressType(false)],
                ["sA1", ["Foo", "add"], new AddressType(true)],
                ["x", ["Foo", "add"], new IntType(8, true)],
                ["y", ["Foo", "add"], new IntType(64, false)],
                ["add", ["Foo", "add"], new IntType(64, false)],
                ["-x", ["Foo", "add"], new IntType(8, true)],
                ["-x", ["Foo", "add"], new IntType(8, true)],
                ["!sB", ["Foo", undefined], new BoolType()],
                ["x+x", ["Foo", "add"], new IntType(8, true)],
                ["x-16", ["Foo", "add"], new IntType(8, true)],
                ["24*x", ["Foo", "add"], new IntType(8, true)],
                ["x/sV1", ["Foo", "add"], new IntType(128, true)],
                ["y%123", ["Foo", "add"], new IntType(64, false)],
                ["33%5", ["Foo", "add"], new IntLiteralType()],
                ["3**2", ["Foo", undefined], new IntLiteralType()],
                ["y**2", ["Foo", "add"], new IntType(64, false)],
                ["2**y", ["Foo", "add"], new IntType(64, false)],
                ["y**sV", ["Foo", "add"], new IntType(64, false)],
                ["y>>x", ["Foo", "add"], new IntType(64, false)],
                ["y>>5", ["Foo", "add"], new IntType(64, false)],
                ["5<<5", ["Foo", "add"], new IntLiteralType()],
                ["sFB32<<5", ["Foo", "add"], new FixedBytesType(32)],
                ["sFB32<<sV", ["Foo", "add"], new FixedBytesType(32)],
                ["5>>y", ["Foo", "add"], new IntType(64, false)],
                ["5>y", ["Foo", "add"], new BoolType()],
                ["sV<y", ["Foo", "add"], new BoolType()],
                ["x<=sV1", ["Foo", "add"], new BoolType()],
                ["10>=x", ["Foo", "add"], new BoolType()],
                ["10==x", ["Foo", "add"], new BoolType()],
                ["sV1!=x", ["Foo", "add"], new BoolType()],
                ["sA==sA1", ["Foo", "add"], new BoolType()],
                ["5 | 1235", ["Foo", "add"], new IntLiteralType()],
                ["5 & x", ["Foo", "add"], new IntType(8, true)],
                ["y ^ sV", ["Foo", "add"], new IntType(256, false)],
                ["sB || sB", ["Foo", undefined], new BoolType()],
                ["true && false", ["Foo", undefined], new BoolType()],
                ["true ==> sB", ["Foo", undefined], new BoolType()],
                ["true ? 1 : 2", ["Foo", undefined], new IntLiteralType()],
                ["sB ? x : 2", ["Foo", "add"], new IntType(8, true)],
                ["sB ? x : sV1", ["Foo", "add"], new IntType(128, true)],
                ["sB ? sA1 : sA", ["Foo", undefined], new AddressType(false)],
                ["sS", ["Foo", undefined], new PointerType(new StringType(), DataLocation.Storage)],
                ["sBy", ["Foo", undefined], new PointerType(new BytesType(), DataLocation.Storage)],
                [
                    "sUArr",
                    ["Foo", undefined],
                    new PointerType(new ArrayType(new IntType(256, false)), DataLocation.Storage)
                ],
                [
                    "sUFixedArr",
                    ["Foo", undefined],
                    new PointerType(
                        new ArrayType(new IntType(256, false), BigInt(5)),
                        DataLocation.Storage
                    )
                ],
                [
                    "sI64Arr",
                    ["Foo", undefined],
                    new PointerType(new ArrayType(new IntType(64, true)), DataLocation.Storage)
                ],
                [
                    "sNestedArr",
                    ["Foo", undefined],
                    new PointerType(
                        new ArrayType(
                            new PointerType(
                                new ArrayType(new IntType(8, false)),
                                DataLocation.Storage
                            )
                        ),
                        DataLocation.Storage
                    )
                ],
                ["sFB32", ["Foo", undefined], new FixedBytesType(32)],
                ["sFB16", ["Foo", undefined], new FixedBytesType(16)],
                [
                    "mUArr",
                    ["Foo", "foo"],
                    new PointerType(new ArrayType(new IntType(256, false)), DataLocation.Memory)
                ],
                ["mBy", ["Foo", "foo"], new PointerType(new BytesType(), DataLocation.Memory)],
                ["mS", ["Foo", "foo"], new PointerType(new StringType(), DataLocation.Memory)],
                ["sBy[1]", ["Foo", undefined], new FixedBytesType(1)],
                ["sBy[sV]", ["Foo", undefined], new FixedBytesType(1)],
                ["sBy[sV1]", ["Foo", undefined], new FixedBytesType(1)],
                ["sFB32[4]", ["Foo", undefined], new IntType(8, false)],
                ["sFB32[sV1]", ["Foo", undefined], new IntType(8, false)],
                ["sUArr[sV]", ["Foo", undefined], new IntType(256, false)],
                ["sUFixedArr[sV]", ["Foo", undefined], new IntType(256, false)],
                ["sI64Arr[sV]", ["Foo", undefined], new IntType(64, true)],
                [
                    "sNestedArr[sV]",
                    ["Foo", undefined],
                    new PointerType(new ArrayType(new IntType(8, false)), DataLocation.Storage)
                ],
                ["sNestedArr[sV][0]", ["Foo", undefined], new IntType(8, false)],
                ["sM[0]", ["Foo", undefined], new IntType(64, true)],
                ["sM[u32a]", ["Foo", undefined], new IntType(64, true)],
                ["sM[sNestedArr[0][0]]", ["Foo", undefined], new IntType(64, true)],
                [
                    "sFoo",
                    ["Foo", undefined],
                    (units) =>
                        new PointerType(
                            new UserDefinedType("Foo.SFoo", findTypeDef("SFoo", units)),
                            DataLocation.Storage
                        )
                ],
                [
                    "sBoo",
                    ["Foo", undefined],
                    (units) => new UserDefinedType("Boo", findTypeDef("Boo", units))
                ],
                ["sFoo.x", ["Foo", undefined], new IntType(256, false)],
                ["sFoo.a", ["Foo", undefined], new AddressType(false)],
                ["sFoo.a.balance", ["Foo", undefined], new IntType(256, false)],
                ["sBoo.balance", ["Foo", undefined], new IntType(256, false)],
                [
                    "sFoo.s",
                    ["Foo", undefined],
                    new PointerType(new StringType(), DataLocation.Storage)
                ],
                [
                    "sMoo",
                    ["Foo", undefined],
                    (units) =>
                        new PointerType(
                            new UserDefinedType("Foo.SMoo", findTypeDef("SMoo", units)),
                            DataLocation.Storage
                        )
                ],
                ["sMoo.foo.x", ["Foo", undefined], new IntType(256, false)],
                [
                    "goos[0].f2",
                    ["Foo", undefined],
                    new PointerType(new BytesType(), DataLocation.Storage)
                ],
                ["address(0x0).balanceOf()", ["Foo", undefined], new IntType(256, false)],
                ["this.balanceOf2()", ["Foo", undefined], new IntType(256, false)],
                ["add(5,5)", ["Foo", undefined], new IntType(64, false)],
                ["old(5)", ["Foo", "add"], new IntLiteralType()],
                ["old(sV1)", ["Foo", "add"], new IntType(128, true)],
                ["old(sA)", ["Foo", "add"], new AddressType(false)],
                ["this.add(5,5)", ["Foo", undefined], new IntType(64, false)],
                ["sBoo.foo(5)", ["Foo", undefined], new IntType(256, false)],
                [
                    "IFace(address(0x0))",
                    ["Foo", undefined],
                    (units) => new UserDefinedType("IFace", findTypeDef("IFace", units))
                ],
                [
                    "IFace(address(0x0)).imoo(5,10)",
                    ["Foo", undefined],
                    new TupleType([
                        new AddressType(false),
                        new PointerType(new StringType(), DataLocation.Memory)
                    ])
                ],
                ["uint256(u32a)", ["Foo", undefined], new IntType(256, false)],
                ["int256(u32a)", ["Foo", undefined], new IntType(256, true)],
                ["bytes32(uint256(u32a))", ["Foo", undefined], new FixedBytesType(32)],
                [
                    "FooEnum(0)",
                    ["Foo", undefined],
                    (units) => new UserDefinedType("Foo.FooEnum", findTypeDef("FooEnum", units))
                ],
                [
                    "Foo(address(0x0))",
                    ["Foo", undefined],
                    (units) => new UserDefinedType("Foo", findTypeDef("Foo", units))
                ],
                ["Lib.ladd(u32a, u32b)", ["Foo", undefined], new IntType(32, false)],
                ["u32a.ladd(u32b)", ["Foo", undefined], new IntType(32, false)],
                ["sS.len()", ["Foo", undefined], new IntType(256, false)],
                ["sV1.foo()", ["Foo", undefined], new BoolType()],
                [
                    "FooEnum.D",
                    ["Foo", undefined],
                    (units) => new UserDefinedType("Foo.FooEnum", findTypeDef("FooEnum", units))
                ],
                [
                    "GlobalEnum.A",
                    ["Foo", undefined],
                    (units) => new UserDefinedType("GlobalEnum", findTypeDef("GlobalEnum", units))
                ],
                [
                    "Boo.BooEnum.G",
                    ["Foo", undefined],
                    (units) => new UserDefinedType("Boo.BooEnum", findTypeDef("BooEnum", units))
                ],
                ["sA.balance", ["Foo", undefined], new IntType(256, false)],
                [
                    "sA.staticcall",
                    ["Foo", undefined],
                    new FunctionType(
                        undefined,
                        [new PointerType(new BytesType(), DataLocation.Memory)],
                        [new BoolType(), new PointerType(new BytesType(), DataLocation.Memory)],
                        FunctionVisibility.Default,
                        FunctionStateMutability.View
                    )
                ],
                ["block.coinbase", ["Foo", undefined], new AddressType(true)],
                ["block.difficulty", ["Foo", undefined], new IntType(256, false)],
                ["block.gaslimit", ["Foo", undefined], new IntType(256, false)],
                ["block.number", ["Foo", undefined], new IntType(256, false)],
                ["block.timestamp", ["Foo", undefined], new IntType(256, false)],
                [
                    "msg.data",
                    ["Foo", undefined],
                    new PointerType(new BytesType(), DataLocation.CallData)
                ],
                ["msg.sender", ["Foo", undefined], new AddressType(true)],
                ["msg.sig", ["Foo", undefined], new FixedBytesType(4)],
                ["msg.value", ["Foo", undefined], new IntType(256, false)],
                ["tx.gasprice", ["Foo", undefined], new IntType(256, false)],
                ["tx.origin", ["Foo", undefined], new AddressType(true)],
                [
                    "blockhash",
                    ["Foo", undefined],
                    new FunctionType(
                        undefined,
                        [new IntType(256, false)],
                        [new FixedBytesType(32)],
                        FunctionVisibility.Default,
                        FunctionStateMutability.View
                    )
                ],
                [
                    "gasleft",
                    ["Foo", undefined],
                    new FunctionType(
                        undefined,
                        [],
                        [new IntType(256, false)],
                        FunctionVisibility.Default,
                        FunctionStateMutability.View
                    )
                ],
                [
                    "now",
                    ["Foo", undefined],
                    new FunctionType(
                        undefined,
                        [],
                        [new IntType(256, false)],
                        FunctionVisibility.Default,
                        FunctionStateMutability.View
                    )
                ],
                [
                    "addmod",
                    ["Foo", undefined],
                    new FunctionType(
                        undefined,
                        [new IntType(256, false), new IntType(256, false), new IntType(256, false)],
                        [new IntType(256, false)],
                        FunctionVisibility.Default,
                        FunctionStateMutability.Pure
                    )
                ],
                [
                    "mulmod",
                    ["Foo", undefined],
                    new FunctionType(
                        undefined,
                        [new IntType(256, false), new IntType(256, false), new IntType(256, false)],
                        [new IntType(256, false)],
                        FunctionVisibility.Default,
                        FunctionStateMutability.Pure
                    )
                ],
                [
                    "keccak256",
                    ["Foo", undefined],
                    new FunctionType(
                        undefined,
                        [new PointerType(new BytesType(), DataLocation.Memory)],
                        [new FixedBytesType(32)],
                        FunctionVisibility.Default,
                        FunctionStateMutability.Pure
                    )
                ],
                [
                    "sha256",
                    ["Foo", undefined],
                    new FunctionType(
                        undefined,
                        [new PointerType(new BytesType(), DataLocation.Memory)],
                        [new FixedBytesType(32)],
                        FunctionVisibility.Default,
                        FunctionStateMutability.Pure
                    )
                ],
                [
                    "ripemd160",
                    ["Foo", undefined],
                    new FunctionType(
                        undefined,
                        [new PointerType(new BytesType(), DataLocation.Memory)],
                        [new FixedBytesType(20)],
                        FunctionVisibility.Default,
                        FunctionStateMutability.Pure
                    )
                ],
                [
                    "ecrecover",
                    ["Foo", undefined],
                    new FunctionType(
                        undefined,
                        [
                            new FixedBytesType(32),
                            new IntType(8, false),
                            new FixedBytesType(32),
                            new FixedBytesType(32)
                        ],
                        [new AddressType(false)],
                        FunctionVisibility.Default,
                        FunctionStateMutability.Pure
                    )
                ],
                ["$result", ["Foo", "add"], new IntType(64, false)],
                [
                    "$result",
                    ["Foo", "idPair"],
                    new TupleType([new IntType(256, false), new IntType(256, false)])
                ]
            ]
        ],
        [
            "versioned.sol",
            `pragma solidity 0.8.0;

            contract Some {
                address public addr;
            }
            `,
            [
                [
                    "addr.code",
                    ["Some", undefined],
                    new PointerType(new BytesType(), DataLocation.Memory)
                ]
            ]
        ]
    ];

    const badSamples: Array<[string, string, Array<[string, LocationDesc]>]> = [
        [
            "foo.sol",
            `pragma solidity 0.6.0;

            enum GlobalEnum {
                A,
                B,
                C
            }

            library Lib {
                function ladd(uint32 a, uint32 b) public returns (uint32) {
                    return a+b;
                }
            }

            library Lib2 {
                function foo(int128 x) public returns (bool) {
                    return true;
                }
            }
            
            interface IFace {
                function imoo(int8 d, int16 e) external returns (address, string memory);
            }

            contract Boo {
                enum BooEnum {
                    G,
                    H,
                    I
                }
            }

            contract Foo {
                uint sV;
                int128 sV1;
                address sA;
                bool b;
                using Lib2 for *;

                mapping (uint32 => int64) sM;

                function add(uint x, uint y) public returns(uint add) {
                    return x + y;
                }

                function noReturn(uint x) public {}
            }`,
            [
                ["int23", ["Foo", undefined]],
                ["int264", ["Foo", undefined]],
                ["bytes33", ["Foo", undefined]],
                ["sMissing", ["Foo", undefined]],
                ["sMissing", ["Foo", "add"]],
                ["x", ["Foo", undefined]],
                ["!sV", ["Foo", undefined]],
                ["-sA", ["Foo", undefined]],
                ["x+y", ["Foo", undefined]],
                ["sV1/sV", ["Foo", undefined]],
                ["sV1%sA", ["Foo", undefined]],
                ["sV**sV1", ["Foo", undefined]],
                ["2**sV1", ["Foo", undefined]],
                ["x<<sA", ["Foo", undefined]],
                ["sA<<x", ["Foo", undefined]],
                ["x<<x", ["Foo", undefined]],
                ["x<<5", ["Foo", undefined]],
                ["y<=sV1", ["Foo", "add"]],
                ["sA>sA", ["Foo", "add"]],
                ["sA==x", ["Foo", "add"]],
                ["sA!=1", ["Foo", "add"]],
                ["x==sV1", ["Foo", "add"]],
                ["x&sV1", ["Foo", "add"]],
                ["sA&sA", ["Foo", "add"]],
                ["x&sA", ["Foo", "add"]],
                ["b || sV", ["Foo", "add"]],
                ["sA && true", ["Foo", "add"]],
                ["x ? 1 : 2", ["Foo", "add"]],
                ["sS[1]", ["Foo", undefined]],
                ["sV[1]", ["Foo", undefined]],
                ["sM[sV]", ["Foo", undefined]],
                ["sM[sV1]", ["Foo", undefined]],
                ["sM[sA]", ["Foo", undefined]],
                ["sV1.balance", ["Foo", undefined]],
                ["add(5)", ["Foo", undefined]],
                ["add(5, true)", ["Foo", undefined]],
                ["add(5, int256(5))", ["Foo", undefined]],
                ["noFunc(5, 5)", ["Foo", undefined]],
                // @todo This should not type check. Fix later on
                //["IFace.imoo(5,10)", ["Foo", undefined]],
                ["Lib.ladd(sV1, sV1)", ["Foo", undefined]],
                ["sBoo.a", ["Foo", undefined]],
                ["sBoo.s", ["Foo", undefined]],
                ["sBoo.str", ["Foo", undefined]],
                ["sA.foo()", ["Foo", undefined]],
                ["FooEnum.X", ["Foo", undefined]],
                ["BooEnum.G", ["Foo", undefined]],
                ["sA.any", ["Foo", undefined]],
                ["block.any", ["Foo", undefined]],
                ["msg.any", ["Foo", undefined]],
                ["tx.any", ["Foo", undefined]],
                ["$result", ["Foo", undefined]],
                ["$result", ["Foo", "noReturn"]]
            ]
        ],
        [
            "versioned.sol",
            `pragma solidity 0.4.13;

            contract Some {
                address public addr;
            }
            `,
            [["addr.code", ["Some", undefined]]]
        ]
    ];

    for (const [fileName, content, testCases] of goodSamples) {
        describe(`Positive tests for #${fileName}`, () => {
            let sources: SourceUnit[];
            let compilerVersion: string;

            before(() => {
                [sources, , , compilerVersion] = toAst(fileName, content);
            });

            for (const [specString, loc, expected] of testCases) {
                it(`Typecheck for ${specString}`, () => {
                    const expectedType =
                        expected instanceof TypeNode ? expected : expected(sources);
                    const [typeCtx, target] = getTypeCtxAndTarget(loc, sources);
                    const parsed = parse(specString, target, compilerVersion);
                    const typeEnv = new TypeEnv(compilerVersion);
                    const type = tc(parsed, typeCtx, typeEnv);
                    Logger.debug(
                        `[${specString}]: Got: ${type.pp()} expected: ${expectedType.pp()}`
                    );
                    expect(eq(type, expectedType)).toEqual(true);
                });
            }
        });
    }

    for (const [fileName, content, testCases] of badSamples) {
        describe(`Negative tests for #${fileName}`, () => {
            let sources: SourceUnit[];
            let compilerVersion: string;
            let typeEnv: TypeEnv;

            before(() => {
                [sources, , , compilerVersion] = toAst(fileName, content);

                typeEnv = new TypeEnv(compilerVersion);
            });

            for (const [specString, loc] of testCases) {
                it(`Typecheck for ${specString} throws`, () => {
                    const [typeCtx, target] = getTypeCtxAndTarget(loc, sources);
                    const parsed = parse(specString, target, compilerVersion);

                    expect(() => tc(parsed, typeCtx, typeEnv)).toThrow();
                });
            }
        });
    }
});

describe("TypeChecker Annotation Tests", () => {
    const goodSamples: Array<
        [string, string, Array<[string, LocationDesc, TypeNode | undefined, boolean]>]
    > = [
        [
            "foo.sol",
            `pragma solidity 0.6.0;
             contract Base {
                 uint x;
                 function plus(uint t) public returns (uint) {
                     x+=t;
                     return x;
                 }
             }

             contract Child is Base {
                 uint y;
                 function minus(uint t) public returns (uint) {
                     x-=t;
                     return x;
                 }

                 function plusOne() public returns (uint) {
                     return plus(1);
                 }
             }


             contract Unrelated {
                 int64 z;
                 int64 w;
                 uint[] arr;

                 struct SArr {
                    uint[] arr;
                 }

                 struct SStruct {
                    SArr sArr;
                 }

                 mapping (bytes => uint) m1;
                 mapping (address => mapping (bytes => bool)) m2;
                 mapping (address => SStruct) m3;
                 mapping (string => bool) m4;
             }`,
            [
                ["if_succeeds x > 0;", ["Base", "plus"], undefined, true],
                ["if_succeeds old(x) + t == x;", ["Base", "plus"], undefined, true],
                [
                    "define foo() uint = 1;",
                    ["Base", undefined],
                    new FunctionType(
                        undefined,
                        [],
                        [new IntType(256, false)],
                        FunctionVisibility.Internal,
                        FunctionStateMutability.View
                    ),
                    true
                ],
                [
                    "define foo() uint = x;",
                    ["Base", undefined],
                    new FunctionType(
                        undefined,
                        [],
                        [new IntType(256, false)],
                        FunctionVisibility.Internal,
                        FunctionStateMutability.View
                    ),
                    true
                ],
                [
                    "define foo(uint a) uint = x + a;",
                    ["Base", undefined],
                    new FunctionType(
                        undefined,
                        [new IntType(256, false)],
                        [new IntType(256, false)],
                        FunctionVisibility.Internal,
                        FunctionStateMutability.View
                    ),
                    true
                ],
                [
                    "define boo(uint a) uint = plus(foo(a));",
                    ["Base", undefined],
                    new FunctionType(
                        undefined,
                        [new IntType(256, false)],
                        [new IntType(256, false)],
                        FunctionVisibility.Internal,
                        FunctionStateMutability.View
                    ),
                    false
                ],
                [
                    "if_succeeds old(foo(t)) == x;",
                    ["Base", "plus"],
                    new FunctionType(
                        undefined,
                        [new IntType(256, false)],
                        [new IntType(256, false)],
                        FunctionVisibility.Internal,
                        FunctionStateMutability.View
                    ),
                    false
                ],
                [
                    "define moo(uint a) uint = foo(a) + boo(a);",
                    ["Child", undefined],
                    new FunctionType(
                        undefined,
                        [new IntType(256, false)],
                        [new IntType(256, false)],
                        FunctionVisibility.Internal,
                        FunctionStateMutability.View
                    ),
                    false
                ],
                ["if_updated z>0;", ["Unrelated", "z"], new BoolType(), true],
                ["if_updated z>w;", ["Unrelated", "z"], new BoolType(), true],
                ["if_updated true;", ["Unrelated", "arr"], new BoolType(), true],
                ["if_updated arr.length > 0;", ["Unrelated", "arr"], new BoolType(), true],
                ["if_assigned[i] arr[i+1] == 1;", ["Unrelated", "arr"], new BoolType(), true],
                [
                    "if_assigned[bts] bts[0] == byte(0x01);",
                    ["Unrelated", "m1"],
                    new BoolType(),
                    true
                ],
                [
                    "if_assigned[addr] addr == address(0x0);",
                    ["Unrelated", "m2"],
                    new BoolType(),
                    true
                ],
                [
                    "if_assigned[addr][bts] addr == address(0x0) && bts[0] == byte(0x01);",
                    ["Unrelated", "m2"],
                    new BoolType(),
                    true
                ],
                [
                    "if_assigned[addr].sArr.arr[x] addr == address(0x0) && x <= 10;",
                    ["Unrelated", "m3"],
                    new BoolType(),
                    true
                ],
                [
                    "if_assigned[str] bytes(str)[0] == byte(0x00);",
                    ["Unrelated", "m4"],
                    new BoolType(),
                    true
                ],
                ["if_updated old(z)>0;", ["Unrelated", "z"], new BoolType(), true]
            ]
        ]
    ];

    const badSamples: Array<
        [string, string, Array<[string, LocationDesc]>, Array<[string, LocationDesc]>]
    > = [
        [
            "foo.sol",
            `pragma solidity 0.6.0;
             contract Base {
                 uint x;
                 function plus(uint t) public returns (uint) {
                     x+=t;
                     return x;
                 }
             }

             contract Child is Base {
                 uint y;
                 function minus(uint t) public returns (uint) {
                     x-=t;
                     return x;
                 }

                 function plusOne() public returns (uint) {
                     return plus(1);
                 }
             }

             contract Unrelated {
                 int64 z;
                 uint[] arr;

                 struct SArr {
                    uint[] arr;
                 }

                 struct SStruct {
                    SArr sArr;
                 }

                 mapping (string => uint) m1;
                 mapping (address => mapping (string => bool)) m2;
                
             }`,
            [["define user_plusOne(uint x) uint = x+1;", ["Base", undefined]]],
            [
                ["if_succeeds z > 0;", ["Base", "plus"]],
                ["invariant $result > 0;", ["Base", undefined]],
                ["define foo() uint = true;", ["Base", undefined]],
                ["define foo() uint = x;", ["Unrelated", undefined]],
                ["define foo() uint = 1;", ["Base", "plus"]],
                ["define foo() uint256 = $result;", ["Base", undefined]],
                [
                    "define foo(uint t, uint[253] arr) uint = user_plusOne(t);",
                    ["Unrelated", undefined]
                ],
                ["if_assigned.foo true;", ["Unrelated", "z"]],
                ["if_assigned[x] true;", ["Unrelated", "z"]],
                ["if_assigned.foo true;", ["Unrelated", "arr"]],
                ["if_assigned[x][y] true;", ["Unrelated", "arr"]],
                ["if_assigned[bts][bad] bts[0] == byte(0x01);", ["Unrelated", "m1"]],
                [
                    "if_assigned[bts][addr] addr == address(0x0) && bts[0] == byte(0x01);",
                    ["Unrelated", "m2"]
                ]
            ]
        ]
    ];

    for (const [fileName, content, testCases] of goodSamples) {
        describe(`Positive tests for #${fileName}`, () => {
            let sources: SourceUnit[];
            let compilerVersion: string;
            let typeEnv: TypeEnv;

            before(() => {
                [sources, , , compilerVersion] = toAst(fileName, content);

                typeEnv = new TypeEnv(compilerVersion);
            });

            for (const [specString, loc, expectedType, clearFunsBefore] of testCases) {
                it(`Typecheck for ${specString} succeeds.`, () => {
                    const target = getTarget(loc, sources);
                    const parsed = parseAnnotation(specString, target, compilerVersion);
                    const [ctx] = getTypeCtxAndTarget(loc, sources, parsed);

                    if (clearFunsBefore) {
                        typeEnv = new TypeEnv(compilerVersion);
                    }

                    tcAnnotation(parsed, ctx, target, typeEnv);
                    if (parsed instanceof SUserFunctionDefinition) {
                        assert(expectedType !== undefined, ``);
                        const received = tc(new SId(parsed.name.name), ctx, typeEnv);
                        Logger.debug(
                            `[${specString}]: Expected type ${expectedType.pp()} received: ${(received as TypeNode).pp()}`
                        );
                        expect(eq(received, expectedType)).toEqual(true);
                    }
                });
            }
        });
    }

    for (const [fileName, content, setupSteps, testCases] of badSamples) {
        describe(`Negative tests for #${fileName}`, () => {
            let sources: SourceUnit[];
            let compilerVersion: string;
            let typeEnv: TypeEnv;

            before(() => {
                [sources, , , compilerVersion] = toAst(fileName, content);

                typeEnv = new TypeEnv(compilerVersion);

                // Setup any definitions
                for (const [specString, loc] of setupSteps) {
                    const [ctx, target] = getTypeCtxAndTarget(loc, sources);
                    const parsed = parseAnnotation(specString, target, compilerVersion);

                    tcAnnotation(parsed, ctx, target, typeEnv);
                }
            });

            for (const [specString, loc] of testCases) {
                it(`Typecheck for ${specString} throws`, () => {
                    const target = getTarget(loc, sources);
                    const parsed = parseAnnotation(specString, target, compilerVersion);
                    const [ctx] = getTypeCtxAndTarget(loc, sources, parsed);
                    Logger.debug(
                        `[${specString}]: Expect typechecking of ${parsed.pp()} in ctx ${pp(
                            ctx
                        )} to throw`
                    );
                    expect(() => tcAnnotation(parsed, ctx, target, typeEnv)).toThrow();
                });
            }
        });
    }
});
