import expect from "expect";
import {
    AddressType,
    ArrayType,
    assert,
    BoolType,
    BuiltinFunctionType,
    BytesType,
    ContractDefinition,
    DataLocation,
    EnumDefinition,
    eq,
    FixedBytesType,
    stringToBytes,
    FunctionStateMutability,
    FunctionType,
    FunctionVisibility,
    InferType,
    IntLiteralType,
    IntType,
    PointerType,
    pp,
    PPIsh,
    SourceUnit,
    StringLiteralType,
    StringType,
    StructDefinition,
    TupleType,
    TypeNameType,
    TypeNode,
    UserDefinedType,
    UserDefinedValueTypeDefinition,
    UserDefinition
} from "solc-typed-ast";
import { Logger } from "../../src/logger";
import { SId, SUserFunctionDefinition } from "../../src/spec-lang/ast";
import { parseAnnotation, parseExpression as parse } from "../../src/spec-lang/expr_parser";
import { tc, tcAnnotation, TypeEnv } from "../../src/spec-lang/tc";
import { SolFile, SourceFile } from "../../src/util/sources";
import { getTarget, getTypeCtxAndTarget, LocationDesc, toAst } from "../integration/utils";

function findTypeDef(name: string, units: SourceUnit[]): UserDefinition {
    for (const unit of units) {
        for (const child of unit.getChildrenBySelector(
            (child) =>
                (child instanceof ContractDefinition ||
                    child instanceof StructDefinition ||
                    child instanceof EnumDefinition ||
                    child instanceof UserDefinedValueTypeDefinition) &&
                child.name === name
        )) {
            return child as UserDefinition;
        }
    }

    assert(false, 'Unable to detect type def for name "{0}"', name);
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

                mapping (address => Boo)[] public pubV;

                struct Loo {
                    int8 a;
                    string b;
                    int[] arr;
                }

                Loo[] public pubV2;
            }`,
            [
                ["uint", ["Foo"], new TypeNameType(new IntType(256, false))],
                ["int24", ["Foo"], new TypeNameType(new IntType(24, true))],
                ["byte", ["Foo"], new TypeNameType(new FixedBytesType(1))],
                ["bytes3", ["Foo"], new TypeNameType(new FixedBytesType(3))],
                ["string", ["Foo"], new TypeNameType(new StringType())],
                ["address payable", ["Foo"], new TypeNameType(new AddressType(true))],
                ["true", ["Foo"], new BoolType()],
                ["1", ["Foo"], new IntLiteralType(BigInt(1))],
                ["hex'0011ff'", ["Foo"], new StringLiteralType("hexString")],
                ['hex""', ["Foo"], new StringLiteralType("hexString")],
                ['"abc \\" \\u0000 \\x01 Def "', ["Foo"], new StringLiteralType("string")],
                ["''", ["Foo"], new StringLiteralType("string")],
                ["1e10", ["Foo"], new IntLiteralType(BigInt(10 ** 10))],
                ["10e+5", ["Foo"], new IntLiteralType(BigInt(10 ** 6))],
                ["1000e-2", ["Foo"], new IntLiteralType(BigInt(10))],
                ["0xAaaaAaAAaaaAAaAAaAaaaaAAAAAaAaaaAaAaaAA0", ["Foo"], new AddressType(true)],
                [
                    "0xAaaaAaAAaaaAAaAAaAaaaaAAAAAaAaaaAaAaaAA0.balance",
                    ["Foo"],
                    new IntType(256, false)
                ],
                ["sV", ["Foo"], new IntType(256, false)],
                ["sV1", ["Foo"], new IntType(128, true)],
                ["sA", ["Foo"], new AddressType(false)],
                ["sA1", ["Foo", "add"], new AddressType(true)],
                ["x", ["Foo", "add"], new IntType(8, true)],
                ["y", ["Foo", "add"], new IntType(64, false)],
                ["add", ["Foo", "add"], new IntType(64, false)],
                ["-x", ["Foo", "add"], new IntType(8, true)],
                ["-x", ["Foo", "add"], new IntType(8, true)],
                ["!sB", ["Foo"], new BoolType()],
                ["x+x", ["Foo", "add"], new IntType(8, true)],
                ["x-16", ["Foo", "add"], new IntType(8, true)],
                ["24*x", ["Foo", "add"], new IntType(8, true)],
                ["x/sV1", ["Foo", "add"], new IntType(128, true)],
                ["y%123", ["Foo", "add"], new IntType(64, false)],
                ["33%5", ["Foo", "add"], new IntLiteralType(BigInt(3))],
                ["3**2", ["Foo"], new IntLiteralType(BigInt(9))],
                ["y**2", ["Foo", "add"], new IntType(64, false)],
                ["2**y", ["Foo", "add"], new IntType(64, false)],
                ["y**sV", ["Foo", "add"], new IntType(64, false)],
                ["y>>x", ["Foo", "add"], new IntType(64, false)],
                ["y>>5", ["Foo", "add"], new IntType(64, false)],
                ["5<<5", ["Foo", "add"], new IntLiteralType(BigInt(160))],
                ["sFB32<<5", ["Foo", "add"], new FixedBytesType(32)],
                ["sFB32<<sV", ["Foo", "add"], new FixedBytesType(32)],
                ["5>>y", ["Foo", "add"], new IntType(64, false)],
                ["5>y", ["Foo", "add"], new BoolType()],
                ["sV<y", ["Foo", "add"], new BoolType()],
                ["sA < sA1", ["Foo"], new BoolType()],
                ["x<=sV1", ["Foo", "add"], new BoolType()],
                ["10>=x", ["Foo", "add"], new BoolType()],
                ["10==x", ["Foo", "add"], new BoolType()],
                ["sV1!=x", ["Foo", "add"], new BoolType()],
                ["sA==sA1", ["Foo", "add"], new BoolType()],
                ["5 | 1235", ["Foo", "add"], new IntLiteralType()],
                ["5 & x", ["Foo", "add"], new IntType(8, true)],
                ["y ^ sV", ["Foo", "add"], new IntType(256, false)],
                ["sB || sB", ["Foo"], new BoolType()],
                ["true && false", ["Foo"], new BoolType()],
                ["true ==> sB", ["Foo"], new BoolType()],
                ["true ? 1 : 2", ["Foo"], new IntLiteralType()],
                ["sB ? x : 2", ["Foo", "add"], new IntType(8, true)],
                ["sB ? x : sV1", ["Foo", "add"], new IntType(128, true)],
                ["sB ? sA1 : sA", ["Foo"], new AddressType(false)],
                ["sS", ["Foo"], new PointerType(new StringType(), DataLocation.Storage)],
                ["sBy", ["Foo"], new PointerType(new BytesType(), DataLocation.Storage)],
                [
                    "sUArr",
                    ["Foo"],
                    new PointerType(new ArrayType(new IntType(256, false)), DataLocation.Storage)
                ],
                [
                    "sUFixedArr",
                    ["Foo"],
                    new PointerType(
                        new ArrayType(new IntType(256, false), BigInt(5)),
                        DataLocation.Storage
                    )
                ],
                [
                    "sI64Arr",
                    ["Foo"],
                    new PointerType(new ArrayType(new IntType(64, true)), DataLocation.Storage)
                ],
                [
                    "sNestedArr",
                    ["Foo"],
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
                ["sFB32", ["Foo"], new FixedBytesType(32)],
                ["sFB16", ["Foo"], new FixedBytesType(16)],
                [
                    "mUArr",
                    ["Foo", "foo"],
                    new PointerType(new ArrayType(new IntType(256, false)), DataLocation.Memory)
                ],
                ["mBy", ["Foo", "foo"], new PointerType(new BytesType(), DataLocation.Memory)],
                ["mS", ["Foo", "foo"], new PointerType(new StringType(), DataLocation.Memory)],
                ["sBy[1]", ["Foo"], new FixedBytesType(1)],
                ["sBy[sV]", ["Foo"], new FixedBytesType(1)],
                ["sBy[sV1]", ["Foo"], new FixedBytesType(1)],
                ["sFB32[4]", ["Foo"], new IntType(8, false)],
                ["sFB32[sV1]", ["Foo"], new IntType(8, false)],
                ["sUArr[sV]", ["Foo"], new IntType(256, false)],
                ["sUFixedArr[sV]", ["Foo"], new IntType(256, false)],
                ["sI64Arr[sV]", ["Foo"], new IntType(64, true)],
                [
                    "sNestedArr[sV]",
                    ["Foo"],
                    new PointerType(new ArrayType(new IntType(8, false)), DataLocation.Storage)
                ],
                ["sNestedArr[sV][0]", ["Foo"], new IntType(8, false)],
                ["sM[0]", ["Foo"], new IntType(64, true)],
                ["sM[u32a]", ["Foo"], new IntType(64, true)],
                ["sM[sNestedArr[0][0]]", ["Foo"], new IntType(64, true)],
                [
                    "sFoo",
                    ["Foo"],
                    (units) =>
                        new PointerType(
                            new UserDefinedType("Foo.SFoo", findTypeDef("SFoo", units)),
                            DataLocation.Storage
                        )
                ],
                ["sBoo", ["Foo"], (units) => new UserDefinedType("Boo", findTypeDef("Boo", units))],
                ["sFoo.x", ["Foo"], new IntType(256, false)],
                ["sFoo.a", ["Foo"], new AddressType(false)],
                ["sFoo.a.balance", ["Foo"], new IntType(256, false)],
                ["sBoo.balance", ["Foo"], new IntType(256, false)],
                ["sFoo.s", ["Foo"], new PointerType(new StringType(), DataLocation.Storage)],
                [
                    "sMoo",
                    ["Foo"],
                    (units) =>
                        new PointerType(
                            new UserDefinedType("Foo.SMoo", findTypeDef("SMoo", units)),
                            DataLocation.Storage
                        )
                ],
                ["sMoo.foo.x", ["Foo"], new IntType(256, false)],
                ["goos[0].f2", ["Foo"], new PointerType(new BytesType(), DataLocation.Storage)],
                ["address(0x0).balanceOf()", ["Foo"], new IntType(256, false)],
                ["this.balanceOf2()", ["Foo"], new IntType(256, false)],
                ["add(5,5)", ["Foo"], new IntType(64, false)],
                ["old(5)", ["Foo", "add"], new IntLiteralType(BigInt(5))],
                ["old(sV1)", ["Foo", "add"], new IntType(128, true)],
                ["old(sA)", ["Foo", "add"], new AddressType(false)],
                ["this.add(5,5)", ["Foo"], new IntType(64, false)],
                ["sBoo.foo(5)", ["Foo"], new IntType(256, false)],
                [
                    "IFace(address(0x0))",
                    ["Foo"],
                    (units) => new UserDefinedType("IFace", findTypeDef("IFace", units))
                ],
                [
                    "IFace(address(0x0)).imoo(5,10)",
                    ["Foo"],
                    new TupleType([
                        new AddressType(false),
                        new PointerType(new StringType(), DataLocation.Memory)
                    ])
                ],
                ["uint256(u32a)", ["Foo"], new IntType(256, false)],
                ["int256(u32a)", ["Foo"], new IntType(256, true)],
                ["bytes32(uint256(u32a))", ["Foo"], new FixedBytesType(32)],
                [
                    "FooEnum(0)",
                    ["Foo"],
                    (units) => new UserDefinedType("Foo.FooEnum", findTypeDef("FooEnum", units))
                ],
                [
                    "Foo(address(0x0))",
                    ["Foo"],
                    (units) => new UserDefinedType("Foo", findTypeDef("Foo", units))
                ],
                ["Lib.ladd(u32a, u32b)", ["Foo"], new IntType(32, false)],
                ["u32a.ladd(u32b)", ["Foo"], new IntType(32, false)],
                ["sS.len()", ["Foo"], new IntType(256, false)],
                ["sV1.foo()", ["Foo"], new BoolType()],
                [
                    "FooEnum.D",
                    ["Foo"],
                    (units) => new UserDefinedType("Foo.FooEnum", findTypeDef("FooEnum", units))
                ],
                [
                    "GlobalEnum.A",
                    ["Foo"],
                    (units) => new UserDefinedType("GlobalEnum", findTypeDef("GlobalEnum", units))
                ],
                [
                    "Boo.BooEnum.G",
                    ["Foo"],
                    (units) => new UserDefinedType("Boo.BooEnum", findTypeDef("BooEnum", units))
                ],
                ["sA.balance", ["Foo"], new IntType(256, false)],
                [
                    "sA.staticcall",
                    ["Foo"],
                    new BuiltinFunctionType(
                        "staticcall",
                        [new PointerType(new BytesType(), DataLocation.Memory)],
                        [new BoolType(), new PointerType(new BytesType(), DataLocation.Memory)]
                    )
                ],
                ["block.coinbase", ["Foo"], new AddressType(true)],
                ["block.difficulty", ["Foo"], new IntType(256, false)],
                ["block.gaslimit", ["Foo"], new IntType(256, false)],
                ["block.number", ["Foo"], new IntType(256, false)],
                ["block.timestamp", ["Foo"], new IntType(256, false)],
                ["msg.data", ["Foo"], new PointerType(new BytesType(), DataLocation.CallData)],
                ["msg.sender", ["Foo"], new AddressType(true)],
                ["msg.sig", ["Foo"], new FixedBytesType(4)],
                ["msg.value", ["Foo"], new IntType(256, false)],
                ["tx.gasprice", ["Foo"], new IntType(256, false)],
                ["tx.origin", ["Foo"], new AddressType(true)],
                [
                    "blockhash",
                    ["Foo"],
                    new BuiltinFunctionType(
                        "blockhash",
                        [new IntType(256, false)],
                        [new FixedBytesType(32)]
                    )
                ],
                [
                    "gasleft",
                    ["Foo"],
                    new BuiltinFunctionType("gasleft", [], [new IntType(256, false)])
                ],
                ["now", ["Foo"], new IntType(256, false)],
                [
                    "addmod",
                    ["Foo"],
                    new BuiltinFunctionType(
                        "addmod",
                        [new IntType(256, false), new IntType(256, false), new IntType(256, false)],
                        [new IntType(256, false)]
                    )
                ],
                [
                    "mulmod",
                    ["Foo"],
                    new BuiltinFunctionType(
                        "mulmod",
                        [new IntType(256, false), new IntType(256, false), new IntType(256, false)],
                        [new IntType(256, false)]
                    )
                ],
                [
                    "keccak256",
                    ["Foo"],
                    new BuiltinFunctionType(
                        "keccak256",
                        [new PointerType(new BytesType(), DataLocation.Memory)],
                        [new FixedBytesType(32)]
                    )
                ],
                [
                    "sha256",
                    ["Foo"],
                    new BuiltinFunctionType(
                        "sha256",
                        [new PointerType(new BytesType(), DataLocation.Memory)],
                        [new FixedBytesType(32)]
                    )
                ],
                [
                    "ripemd160",
                    ["Foo"],
                    new BuiltinFunctionType(
                        "ripemd160",
                        [new PointerType(new BytesType(), DataLocation.Memory)],
                        [new FixedBytesType(20)]
                    )
                ],
                [
                    "ecrecover",
                    ["Foo"],
                    new BuiltinFunctionType(
                        "ecrecover",
                        [
                            new FixedBytesType(32),
                            new IntType(8, false),
                            new FixedBytesType(32),
                            new FixedBytesType(32)
                        ],
                        [new AddressType(false)]
                    )
                ],
                ["$result", ["Foo", "add"], new IntType(64, false)],
                [
                    "$result",
                    ["Foo", "idPair"],
                    new TupleType([new IntType(256, false), new IntType(256, false)])
                ],
                ["unchecked_sum(sM)", ["Foo"], new IntType(256, true)],
                ["unchecked_sum(sI64Arr)", ["Foo"], new IntType(256, true)],
                ["abi.encode()", ["Foo"], new PointerType(new BytesType(), DataLocation.Memory)],
                ["abi.encode(sV)", ["Foo"], new PointerType(new BytesType(), DataLocation.Memory)],
                [
                    "abi.encode(sM, sI64Arr, gasleft())",
                    ["Foo"],
                    new PointerType(new BytesType(), DataLocation.Memory)
                ],
                [
                    "abi.encodePacked()",
                    ["Foo"],
                    new PointerType(new BytesType(), DataLocation.Memory)
                ],
                [
                    "abi.encodePacked(sV)",
                    ["Foo"],
                    new PointerType(new BytesType(), DataLocation.Memory)
                ],
                [
                    "abi.encode(sM, sI64Arr, gasleft())",
                    ["Foo"],
                    new PointerType(new BytesType(), DataLocation.Memory)
                ],
                [
                    "abi.encodeWithSelector(bytes4(0x01020304))",
                    ["Foo"],
                    new PointerType(new BytesType(), DataLocation.Memory)
                ],
                [
                    "abi.encodeWithSelector(bytes4(0x01020304), sV, sV1)",
                    ["Foo"],
                    new PointerType(new BytesType(), DataLocation.Memory)
                ],
                [
                    'abi.encodeWithSignature("foo")',
                    ["Foo"],
                    new PointerType(new BytesType(), DataLocation.Memory)
                ],
                [
                    'abi.encodeWithSignature("foo", sV, sV1)',
                    ["Foo"],
                    new PointerType(new BytesType(), DataLocation.Memory)
                ],
                ["type(Foo).name", ["Foo"], new PointerType(new StringType(), DataLocation.Memory)],
                [
                    "type(Foo).creationCode",
                    ["Foo"],
                    new PointerType(new BytesType(), DataLocation.Memory)
                ],
                [
                    "type(Foo).runtimeCode",
                    ["Foo"],
                    new PointerType(new BytesType(), DataLocation.Memory)
                ],
                [
                    "type(IFace).name",
                    ["Foo"],
                    new PointerType(new StringType(), DataLocation.Memory)
                ],
                [
                    "this.pubV(1, address(0))",
                    ["Foo"],
                    (units) => new UserDefinedType("Boo", findTypeDef("Boo", units))
                ],
                [
                    "this.pubV2(1)",
                    ["Foo"],
                    new TupleType([
                        new IntType(8, true),
                        new PointerType(new StringType(), DataLocation.Memory)
                    ])
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
            [["addr.code", ["Some"], new PointerType(new BytesType(), DataLocation.Memory)]]
        ],
        [
            "userDefinedValueTypes.sol",
            `
            pragma solidity 0.8.8;

enum A {
    A,
    B,
    C
}

type Price is uint32;
Price constant OneDollar = Price.wrap(1);

contract UserDefinedValueTypes {
    type Quantity is uint32;

    /// #if_succeeds Price.unwrap(p) * Quantity.unwrap(q) == Price.unwrap($result);
    function orderPrice(Price p, Quantity q) public returns (Price) {
        return Price.wrap(Price.unwrap(p) * Quantity.unwrap(q));
    }
}
            `,
            [
                [
                    "Price.wrap(1)",
                    ["UserDefinedValueTypes"],
                    (units) => new UserDefinedType("Price", findTypeDef("Price", units))
                ],
                ["Price.unwrap(Price.wrap(1))", ["UserDefinedValueTypes"], new IntType(32, false)],
                ["Price.unwrap(OneDollar)", ["UserDefinedValueTypes"], new IntType(32, false)],
                [
                    "q",
                    ["UserDefinedValueTypes", "orderPrice"],
                    (units) =>
                        new UserDefinedType(
                            "UserDefinedValueTypes.Quantity",
                            findTypeDef("Quantity", units)
                        )
                ],
                [
                    "Price.wrap(Price.unwrap(p) * Quantity.unwrap(q))",
                    ["UserDefinedValueTypes", "orderPrice"],
                    (units) => new UserDefinedType("Price", findTypeDef("Price", units))
                ]
            ]
        ],
        [
            "min_max_builtins.sol",
            `pragma solidity 0.6.8;

            contract Foo {
            }
            `,
            [
                ["type(int24).min", ["Foo"], new IntType(24, true)],
                ["type(uint).max", ["Foo"], new IntType(256, false)]
            ]
        ],
        [
            "enum_min_max.sol",
            `pragma solidity 0.8.8;

            contract Foo {
                enum FooEnum {
                    D,
                    E,
                    F
                }
            }
            `,
            [
                [
                    "type(FooEnum).max",
                    ["Foo"],
                    (units) => new UserDefinedType("Foo.FooEnum", findTypeDef("FooEnum", units))
                ],
                [
                    "type(FooEnum).min",
                    ["Foo"],
                    (units) => new UserDefinedType("Foo.FooEnum", findTypeDef("FooEnum", units))
                ]
            ]
        ],
        [
            "interface_id_builtin.sol",
            `pragma solidity 0.6.7;

            interface IFace {
            }

            contract Foo {}
            `,
            [["type(IFace).interfaceId", ["Foo"], new FixedBytesType(4)]]
        ],
        [
            "using_for_0.8.13.sol",
            `pragma solidity ^0.8.13;

            function foo(uint a) pure returns (uint) { return a + 1; }
            function boo(int a) pure returns (int) { return a + 1; }

            using {foo} for uint;

            contract Foo {
                using {boo} for int;
            }
            `,
            [
                ["uint(1).foo()", ["Foo"], new IntType(256, false)],
                ["int(1).boo()", ["Foo"], new IntType(256, true)]
            ]
        ],
        [
            "private_state_var.sol",
            `pragma solidity 0.8.13;
        contract Base {
            uint private x;
        }
        
        contract Child is Base {
             /// #if_succeeds x == 42;
             function foo() public {}
        }
        `,
            [["x", ["Base"], new IntType(256, false)]]
        ],
        [
            "private_state_var.sol",
            `pragma solidity 0.8.13;
        contract Base {
            uint internal x;
        }
        
        contract Child is Base {
             /// #if_succeeds x == 42;
             function foo() public {}
        }
        `,
            [
                ["x", ["Base"], new IntType(256, false)],
                ["x", ["Child"], new IntType(256, false)]
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

                struct S {
                    uint x;
                }

                S sSa;
                mapping (uint32 => int64) sM;

                function add(uint x, uint y) public returns(uint add) {
                    return x + y;
                }

                function noReturn(uint x) public {}

                mapping (address => Boo)[] public pubV;
            }`,
            [
                ["int23", ["Foo"]],
                ["int264", ["Foo"]],
                ["bytes33", ["Foo"]],
                ["sMissing", ["Foo"]],
                ["sMissing", ["Foo", "add"]],
                ["x", ["Foo"]],
                ["!sV", ["Foo"]],
                ["-sA", ["Foo"]],
                ["x+y", ["Foo"]],
                ["sV1/sV", ["Foo"]],
                ["sV1%sA", ["Foo"]],
                ["sV**sV1", ["Foo"]],
                ["2**sV1", ["Foo"]],
                ["x<<sA", ["Foo"]],
                ["sA<<x", ["Foo"]],
                ["x<<x", ["Foo"]],
                ["x<<5", ["Foo"]],
                ["y<=sV1", ["Foo", "add"]],
                ["sA==x", ["Foo", "add"]],
                ["sSa==sSa", ["Foo", "add"]],
                ["sA!=1", ["Foo", "add"]],
                ["x==sV1", ["Foo", "add"]],
                ["x&sV1", ["Foo", "add"]],
                ["sA&sA", ["Foo", "add"]],
                ["x&sA", ["Foo", "add"]],
                ["b || sV", ["Foo", "add"]],
                ["sA && true", ["Foo", "add"]],
                ["x ? 1 : 2", ["Foo", "add"]],
                ["sS[1]", ["Foo"]],
                ["sV[1]", ["Foo"]],
                ["sM[sV]", ["Foo"]],
                ["sM[sV1]", ["Foo"]],
                ["sM[sA]", ["Foo"]],
                ["sV1.balance", ["Foo"]],
                ["add(5)", ["Foo"]],
                ["add(5, true)", ["Foo"]],
                ["add(5, int256(5))", ["Foo"]],
                ["noFunc(5, 5)", ["Foo"]],
                // @todo This should not type check. Fix later on
                //["IFace.imoo(5,10)", ["Foo"]],
                ["Lib.ladd(sV1, sV1)", ["Foo"]],
                ["sBoo.a", ["Foo"]],
                ["sBoo.s", ["Foo"]],
                ["sBoo.str", ["Foo"]],
                ["sA.foo()", ["Foo"]],
                ["FooEnum.X", ["Foo"]],
                ["BooEnum.G", ["Foo"]],
                ["sA.any", ["Foo"]],
                ["block.any", ["Foo"]],
                ["msg.any", ["Foo"]],
                ["tx.any", ["Foo"]],
                ["$result", ["Foo"]],
                ["$result", ["Foo", "noReturn"]],
                ["forall (string x in 0...100) x > 0", ["Foo"]],
                ["forall (uint x in sV) x > 0", ["Foo"]],
                ["unchecked_sum(sV)", ["Foo"]],
                ["abi.encodeWithSelector()", ["Foo"]],
                ["abi.encodeWithSelector(sV)", ["Foo"]],
                ["abi.encodeWithSignature()", ["Foo"]],
                ["abi.encodeWithSignature(sV)", ["Foo"]],
                ["type(int24).min", ["Foo"]],
                ["type(uint).max", ["Foo"]],
                ["type(FooEnum).max", ["Foo"]],
                ["type(FooEnum).min", ["Foo"]],
                ["this.pubV()", ["Foo"]],
                ["this.pubV(false)", ["Foo"]],
                ["this.pubV(1)", ["Foo"]],
                ["this.pubV(1, 2)", ["Foo"]]
            ]
        ],
        [
            "versioned.sol",
            `pragma solidity 0.4.13;

            contract Some {
                address public addr;
            }
            `,
            [["addr.code", ["Some"]]]
        ],
        [
            "userDefinedValueTypes.sol",
            `
            pragma solidity 0.8.8;

enum A {
    A,
    B,
    C
}

type Price is uint32;
Price constant OneDollar = Price.wrap(1);

contract UserDefinedValueTypes {
    type Quantity is uint32;

    /// #if_succeeds Price.unwrap(p) * Quantity.unwrap(q) == Price.unwrap($result);
    function orderPrice(Price p, Quantity q) public returns (Price) {
        return Price.wrap(Price.unwrap(p) * Quantity.unwrap(q));
    }
}
            `,
            [
                ["Price.wrap(false)", ["UserDefinedValueTypes"]],
                ["Price.unwrap(1)", ["UserDefinedValueTypes"]],
                ["Price.wrap(Price.wrap(1))", ["UserDefinedValueTypes"]],
                ["Price.unwrap(Price.unwrap(Price.wrap(1)))", ["UserDefinedValueTypes"]],
                ["Price.warp(1) + Price.wrap(2)", ["UserDefinedValueTypes"]],
                ["Price.warp(1) > Price.wrap(2)", ["UserDefinedValueTypes"]],
                ["Price.warp(1) == Price.wrap(2)", ["UserDefinedValueTypes"]]
            ]
        ],
        [
            "type_builtins.sol",
            `pragma solidity 0.8.8;

            enum GlobalEnum {
                A,
                B,
                C
            }

            interface IFace {
                function imoo(int8 d, int16 e) external returns (address, string memory);
            }

            contract Foo {
                address public addr;
            }
            `,
            [
                ["type(int24, int24).min", ["Foo"]],
                ["type(1).min", ["Foo"]],
                ["int24.max", ["Foo"]],
                ["type(Foo).min", ["Foo"]],
                ["type(GlobalEnum).name", ["Foo"]],
                ["type(true).name", ["Foo"]],
                ["type(Foo).interfaceId", ["Foo"]]
            ]
        ],
        [
            "using_for_0.8.13.sol",
            `pragma solidity ^0.8.13;

            function foo(uint a) pure returns (uint) { return a + 1; }
            function boo(int a) pure returns (int) { return a + 1; }

            using {foo} for uint;

            contract Foo {
                using {boo} for int;
            }
            `,
            [
                ["int(1).foo()", ["Foo"]],
                ["uint(1).boo()", ["Foo"]]
            ]
        ],
        [
            "private_state_var.sol",
            `pragma solidity 0.8.13;
        contract Base {
            uint private x;
        }
        
        contract Child is Base {
             /// #if_succeeds x == 42;
             function foo() public {}
        }`,
            [["x", ["Child"]]]
        ],
        [
            "private_fun.sol",
            `pragma solidity 0.8.13;
        contract Base {
            function plusOne(uint x) private pure returns (uint) {
                return x + 1;
            }
        }
        
        contract Child is Base {
             /// #if_succeeds plusOne(x) == x + 1;
             function foo(uint x) public {}
        }`,
            [["plusOne", ["Child"]]]
        ]
    ];

    for (const [fileName, content, testCases] of goodSamples) {
        describe(`Positive tests for #${fileName}`, () => {
            let units: SourceUnit[];
            let compilerVersion: string;
            let inference: InferType;
            let sourceFile: SourceFile;

            before(async () => {
                const result = await toAst(fileName, content);

                units = result.units;
                compilerVersion = result.compilerVersion;

                inference = new InferType(compilerVersion);
                sourceFile = new SolFile(fileName, stringToBytes(content));
            });

            for (const [specString, loc, expected] of testCases) {
                it(`Typecheck for ${specString}`, () => {
                    const expectedType = expected instanceof TypeNode ? expected : expected(units);
                    const [typeCtx, target] = getTypeCtxAndTarget(loc, units);
                    const parsed = parse(specString, target, inference, sourceFile, 0);
                    const typeEnv = new TypeEnv(inference);
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
            let units: SourceUnit[];
            let compilerVersion: string;
            let typeEnv: TypeEnv;
            let sourceFile: SourceFile;

            before(async () => {
                const result = await toAst(fileName, content);

                units = result.units;
                compilerVersion = result.compilerVersion;

                const inference = new InferType(compilerVersion);

                typeEnv = new TypeEnv(inference);
                sourceFile = new SolFile(fileName, stringToBytes(content));
            });

            for (const [specString, loc] of testCases) {
                it(`Typecheck for ${specString} throws`, () => {
                    const [typeCtx, target] = getTypeCtxAndTarget(loc, units);
                    const parsed = parse(specString, target, typeEnv.inference, sourceFile, 0);

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
                 uint8 a;
                 uint8 b;
                 uint[] arr;
                 uint[][] arr2;
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
                ["#if_succeeds x > 0;", ["Base", "plus"], undefined, true],
                ["#if_succeeds old(x) + t == x;", ["Base", "plus"], undefined, true],
                [
                    "#define foo() uint = 1;",
                    ["Base"],
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
                    "#define foo() uint = x;",
                    ["Base"],
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
                    "#define foo(uint a) uint = x + a;",
                    ["Base"],
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
                    "#define boo(uint a) uint = plus(foo(a));",
                    ["Base"],
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
                    "#if_succeeds old(foo(t)) == x;",
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
                    "#define moo(uint a) uint = foo(a) + boo(a);",
                    ["Child"],
                    new FunctionType(
                        undefined,
                        [new IntType(256, false)],
                        [new IntType(256, false)],
                        FunctionVisibility.Internal,
                        FunctionStateMutability.View
                    ),
                    false
                ],
                ["#if_updated z>0;", ["Unrelated", "z"], new BoolType(), true],
                ["#if_updated z>w;", ["Unrelated", "z"], new BoolType(), true],
                ["#if_updated true;", ["Unrelated", "arr"], new BoolType(), true],
                ["#if_updated arr.length > 0;", ["Unrelated", "arr"], new BoolType(), true],
                ["#if_assigned[i] arr[i+1] == 1;", ["Unrelated", "arr"], new BoolType(), true],
                [
                    "#if_assigned[bts] bts[0] == byte(0x01);",
                    ["Unrelated", "m1"],
                    new BoolType(),
                    true
                ],
                [
                    "#if_assigned[addr] addr == address(0x0);",
                    ["Unrelated", "m2"],
                    new BoolType(),
                    true
                ],
                [
                    "#if_assigned[addr][bts] addr == address(0x0) && bts[0] == byte(0x01);",
                    ["Unrelated", "m2"],
                    new BoolType(),
                    true
                ],
                [
                    "#if_assigned[addr].sArr.arr[x] addr == address(0x0) && x <= 10;",
                    ["Unrelated", "m3"],
                    new BoolType(),
                    true
                ],
                [
                    "#if_assigned[str] bytes(str)[0] == byte(0x00);",
                    ["Unrelated", "m4"],
                    new BoolType(),
                    true
                ],
                ["#if_updated old(z)>0;", ["Unrelated", "z"], new BoolType(), true],
                [
                    "#if_succeeds forall(uint i in 1...10) arr[i] > 0;",
                    ["Base", "plus"],
                    undefined,
                    true
                ],
                [
                    "#if_succeeds forall(uint256 i in a...b) arr[i] > 0;",
                    ["Base", "plus"],
                    undefined,
                    true
                ],
                [
                    "#if_succeeds forall(uint256 i in arr2[0]) arr[i] > 0;",
                    ["Base", "plus"],
                    undefined,
                    true
                ],
                [
                    "#if_succeeds forall(uint256 i in a+b...a*b) arr[i] > 0;",
                    ["Base", "plus"],
                    undefined,
                    true
                ],
                [
                    "#if_succeeds forall(uint256 i in a+b...a*b) arr[i] > 0;",
                    ["Base", "plus"],
                    undefined,
                    true
                ],
                [
                    "#invariant forall(bytes memory b in m1) m1[b] > 0;",
                    ["Unrelated"],
                    undefined,
                    true
                ],
                [
                    "#invariant forall(address a in m3) m3[a].sArr.arr.length > 0;",
                    ["Unrelated"],
                    undefined,
                    true
                ],
                [
                    "#invariant forall(address a in m2) forall(bytes storage b in m2[a]) m2[a][b];",
                    ["Unrelated"],
                    undefined,
                    true
                ],
                ["#invariant forall(string memory s in m4) m4[s];", ["Unrelated"], undefined, true]
            ]
        ],
        [
            "statements04.sol",
            `
            pragma solidity 0.4.26;

contract Statements04 {
    int8 sVar;
    function main(int8 arg1) {
        int8 loc;
        
        loc = 1;
        
        if (loc > 0) 
            loc  = 2;
        else {
            int8 t;
            loc = t+3;
        }
        
        if (loc > 1) {
            loc = 4;
        }
        
        for(int8 iter = 1; iter < arg1; iter += loc) {
            loc += 1;
        }
        
        while (loc < 0) {
            int8 g = 1;
            loc += g;
        }
        
        {
            int16 loc2;
            
            loc2 += int16(loc);
        }
    }
}
            `,
            [
                ["#assert true;", ["Statements04", "main", "//Block/*[1]"], undefined, true],
                ["#assert arg1 > 0;", ["Statements04", "main", "//Block/*[1]"], undefined, true],
                ["#assert loc > 0;", ["Statements04", "main", "//Block/*[1]"], undefined, true],
                ["#assert arg1 > loc;", ["Statements04", "main", "//Block/*[2]"], undefined, true],
                ["#assert arg1 > loc;", ["Statements04", "main", "//Block/*[3]"], undefined, true],
                [
                    "#assert arg1 > loc;",
                    ["Statements04", "main", "//Block/*[3]/ExpressionStatement"],
                    undefined,
                    true
                ],
                [
                    "#assert arg1 > loc;",
                    ["Statements04", "main", "//Block/*[3]/Block"],
                    undefined,
                    true
                ],
                [
                    "#assert arg1 > loc + t;",
                    ["Statements04", "main", "//Block/*[3]/Block/*[2]"],
                    undefined,
                    true
                ],
                ["#assert arg1 > loc;", ["Statements04", "main", "//Block/*[4]"], undefined, true],
                [
                    "#assert arg1 > loc;",
                    ["Statements04", "main", "//Block/*[4]/Block/*[1]"],
                    undefined,
                    true
                ],
                ["#assert arg1 > loc;", ["Statements04", "main", "//Block/*[5]"], undefined, true],
                [
                    "#assert iter <= arg1;",
                    ["Statements04", "main", "//Block/*[5]/ExpressionStatement"],
                    undefined,
                    true
                ],
                [
                    "#assert iter <= arg1;",
                    ["Statements04", "main", "//Block/*[5]/Block"],
                    undefined,
                    true
                ],
                [
                    "#assert loc + arg1 > 0;",
                    ["Statements04", "main", "//Block/*[6]"],
                    undefined,
                    true
                ],
                [
                    "#assert loc + arg1 > 0;",
                    ["Statements04", "main", "//Block/*[6]/Block"],
                    undefined,
                    true
                ],
                [
                    "#assert loc + arg1 + g + sVar> 0;",
                    ["Statements04", "main", "//Block/*[6]/Block/*[2]"],
                    undefined,
                    true
                ],
                [
                    "#assert loc + loc2 + sVar> 0;",
                    ["Statements04", "main", "//Block/*[7]/*[2]"],
                    undefined,
                    true
                ]
            ]
        ],
        [
            "statements08.sol",
            `
            pragma solidity 0.8.7;

contract Statements08 {
    int8 sVar;
    function main(int8 arg1) public {
        int8 loc;
        
        loc = 1;
        
        if (loc > 0) 
            loc  = 2;
        else {
            int8 t;
            loc = t+3;
        }
        
        if (loc > 1) {
            loc = 4;
        }
        
        for(int8 iter = 1; iter < arg1; iter += loc) {
            loc += 1;
        }
        
        while (loc < 0) {
            int8 g = 1;
            loc += g;
        }
        
        {
            int16 loc2;
            
            loc2 += int16(loc);
        }
    }
}
            `,
            [
                ["#assert true;", ["Statements08", "main", "//Block/*[1]"], undefined, true],
                ["#assert arg1 > loc;", ["Statements08", "main", "//Block/*[2]"], undefined, true],
                ["#assert arg1 > loc;", ["Statements08", "main", "//Block/*[3]"], undefined, true],
                [
                    "#assert arg1 > loc;",
                    ["Statements08", "main", "//Block/*[3]/ExpressionStatement"],
                    undefined,
                    true
                ],
                [
                    "#assert arg1 > loc;",
                    ["Statements08", "main", "//Block/*[3]/Block"],
                    undefined,
                    true
                ],
                ["#assert arg1 > loc;", ["Statements08", "main", "//Block/*[4]"], undefined, true],
                [
                    "#assert arg1 > loc;",
                    ["Statements08", "main", "//Block/*[4]/Block/*[1]"],
                    undefined,
                    true
                ],
                ["#assert arg1 > loc;", ["Statements08", "main", "//Block/*[5]"], undefined, true],
                [
                    "#assert iter <= arg1;",
                    ["Statements08", "main", "//Block/*[5]/ExpressionStatement"],
                    undefined,
                    true
                ],
                [
                    "#assert iter <= arg1;",
                    ["Statements08", "main", "//Block/*[5]/Block"],
                    undefined,
                    true
                ],
                [
                    "#assert loc + arg1 > 0;",
                    ["Statements08", "main", "//Block/*[6]"],
                    undefined,
                    true
                ],
                [
                    "#assert loc + arg1 > 0;",
                    ["Statements08", "main", "//Block/*[6]/Block"],
                    undefined,
                    true
                ],
                [
                    "#assert loc + arg1 + sVar> 0;",
                    ["Statements08", "main", "//Block/*[6]/Block/*[1]"],
                    undefined,
                    true
                ],
                [
                    "#assert loc + sVar> 0;",
                    ["Statements08", "main", "//Block/*[7]/*[1]"],
                    undefined,
                    true
                ],
                [
                    "#if_succeeds loc == 0;",
                    ["Statements08", "main", "//Block/*[1]"],
                    undefined,
                    true
                ],
                [
                    "#if_succeeds old(loc) == 0 && loc == 1;",
                    ["Statements08", "main", "//Block/*[2]"],
                    undefined,
                    true
                ],
                [
                    "#if_succeeds loc == 2;",
                    ["Statements08", "main", "//Block/*[3]/Block"],
                    undefined,
                    true
                ],
                [
                    "#if_succeeds loc == 3;",
                    ["Statements08", "main", "//Block/*[3]/Block"],
                    undefined,
                    true
                ],
                [
                    "#if_succeeds arg1 > loc;",
                    ["Statements08", "main", "//Block/*[5]"],
                    undefined,
                    true
                ],
                [
                    "#if_succeeds iter > 1;",
                    ["Statements08", "main", "//Block/*[5]/Block"],
                    undefined,
                    true
                ],
                [
                    "#if_succeeds old(iter < arg1);",
                    ["Statements08", "main", "//Block/*[5]/Block"],
                    undefined,
                    true
                ]
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
                 uint256 a;
                 uint128 b;
                 uint[] arr;
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
            [["#define user_plusOne(uint x) uint = x+1;", ["Base"]]],
            [
                ["#if_succeeds z > 0;", ["Base", "plus"]],
                ["#invariant $result > 0;", ["Base"]],
                ["#define foo() uint = true;", ["Base"]],
                ["#define foo() uint = x;", ["Unrelated"]],
                ["#define foo() uint = 1;", ["Base", "plus"]],
                ["#define foo() uint256 = $result;", ["Base"]],
                ["#define foo(uint t, uint[253] arr) uint = user_plusOne(t);", ["Unrelated"]],
                ["#if_assigned.foo true;", ["Unrelated", "z"]],
                ["#if_assigned[x] true;", ["Unrelated", "z"]],
                ["#if_assigned.foo true;", ["Unrelated", "arr"]],
                ["#if_assigned[x][y] true;", ["Unrelated", "arr"]],
                ["#if_assigned[bts][bad] bts[0] == byte(0x01);", ["Unrelated", "m1"]],
                [
                    "#if_assigned[bts][addr] addr == address(0x0) && bts[0] == byte(0x01);",
                    ["Unrelated", "m2"]
                ],
                ["#if_succeeds forall(uint i in 1...arr) arr[i] > 0;", ["Base", "plus"]],
                ["#if_succeeds forall(uint i in 1...10) i+10;", ["Base", "plus"]],
                ["#if_succeeds forall(uint i in a) true;", ["Base", "plus"]],
                ["#if_succeeds forall(uint8 i in a...b) arr[i] > 0;", ["Base", "plus"]],
                ["#invariant forall(uint8 i in m1) true;", ["Unrelated"]],
                ["#invariant forall(bytes memory i in m1) true;", ["Unrelated"]]
            ]
        ],
        [
            "statements04.sol",
            `
            pragma solidity 0.4.26;

contract Statements04 {
    uint sVar;
    function main(int8 arg1) {
        int8 loc;
        
        loc = 1;
        
        if (loc > 0) 
            loc  = 2;
        else {
            loc = 3;
        }
        
        if (loc > 1) {
            loc = 4;
        }
        
        for(int8 iter = 1; iter < arg1; iter += loc) {
            loc += 1;
        }
        
        while (loc < 0) {
            loc --;
        }
        
        {
            int16 loc2;
            
            loc2 += int16(loc);
        }

        loc++;
    }
}
            `,
            [],
            [["#assert 1;", ["Statements04", "main", "//Block/*[1]"]]]
        ],
        [
            "statements08.sol",
            `
            pragma solidity 0.8.7;

contract Statements08 {
    int8 sVar;
    function main(int8 arg1) public {
        int8 loc;
        
        loc = 1;
        
        if (loc > 0) 
            loc  = 2;
        else {
            int8 t;
            loc = t+3;
        }
        
        if (loc > 1) {
            loc = 4;
        }
        
        for(int8 iter = 1; iter < arg1; iter += loc) {
            loc += 1;
        }
        
        while (loc < 0) {
            int8 g = 1;
            loc += g;
        }
        
        {
            int16 loc2;
            
            loc2 += int16(loc);
        }
    }
}
            `,
            [],
            [
                ["#assert arg1 > loc;", ["Statements08", "main", "//Block/*[1]"]],
                ["#assert arg1 > loc + t;", ["Statements08", "main", "//Block/*[3]/Block/*[1]"]],
                ["#assert loc + loc2 + sVar> 0;", ["Statements08", "main", "//Block/*[7]/*[1]"]],
                ["#assert loc + arg1 + g > 0;", ["Statements08", "main", "//Block/*[6]/Block"]],
                ["#if_succeeds old(loc) == 0;", ["Statements08", "main", "//Block/*[1]"]],
                ["#if_succeeds loc == t + 3;", ["Statements08", "main", "//Block/*[3]/Block"]],
                ["#if_succeeds iter1 > 0;", ["Statements08", "main", "//Block/*[5]"]],
                ["#let loc := 0;", ["Statements08", "main", "//Block/*[2]"]],
                ["#let main := 0;", ["Statements08", "main", "//Block/*[2]"]],
                ["#let sVar := 0;", ["Statements08", "main", "//Block/*[2]"]],
                ["#let Statements08 := 0;", ["Statements08", "main", "//Block/*[2]"]]
            ]
        ]
    ];

    for (const [fileName, content, testCases] of goodSamples) {
        describe(`Positive tests for #${fileName}`, () => {
            let units: SourceUnit[];
            let compilerVersion: string;
            let inference: InferType;
            let typeEnv: TypeEnv;
            let sourceFile: SourceFile;

            before(async () => {
                const result = await toAst(fileName, content);

                units = result.units;
                compilerVersion = result.compilerVersion;

                inference = new InferType(compilerVersion);
                typeEnv = new TypeEnv(inference);
                sourceFile = new SolFile(fileName, stringToBytes(content));
            });

            for (const [specString, loc, expectedType, clearFunsBefore] of testCases) {
                it(`Typecheck for ${specString} succeeds.`, () => {
                    const target = getTarget(loc, units);
                    const parsed = parseAnnotation(specString, target, inference, sourceFile, 0);

                    const [ctx] = getTypeCtxAndTarget(loc, units, parsed);

                    if (clearFunsBefore) {
                        typeEnv = new TypeEnv(inference);
                    }

                    tcAnnotation(parsed, ctx, target, typeEnv);

                    if (parsed instanceof SUserFunctionDefinition) {
                        assert(expectedType !== undefined, ``);

                        const received = tc(new SId(parsed.name.name), ctx, typeEnv);

                        Logger.debug(
                            `[${specString}]: Expected type ${expectedType.pp()} received: ${(
                                received as TypeNode
                            ).pp()}`
                        );

                        expect(eq(received, expectedType)).toEqual(true);
                    }
                });
            }
        });
    }

    for (const [fileName, content, setupSteps, testCases] of badSamples) {
        describe(`Negative tests for #${fileName}`, () => {
            let units: SourceUnit[];
            let compilerVersion: string;
            let typeEnv: TypeEnv;
            let sourceFile: SourceFile;

            before(async () => {
                const result = await toAst(fileName, content);

                units = result.units;
                compilerVersion = result.compilerVersion;

                const inference = new InferType(compilerVersion);

                typeEnv = new TypeEnv(inference);
                sourceFile = new SolFile(fileName, stringToBytes(content));

                // Setup any definitions
                for (const [specString, loc] of setupSteps) {
                    const target = getTarget(loc, units);
                    const parsed = parseAnnotation(specString, target, inference, sourceFile, 0);

                    const [ctx] = getTypeCtxAndTarget(loc, units, parsed);

                    tcAnnotation(parsed, ctx, target, typeEnv);
                }
            });

            for (const [specString, loc] of testCases) {
                it(`Typecheck for ${specString} throws`, () => {
                    const target = getTarget(loc, units);
                    const parsed = parseAnnotation(
                        specString,
                        target,
                        typeEnv.inference,
                        sourceFile,
                        0
                    );

                    const [ctx] = getTypeCtxAndTarget(loc, units, parsed);

                    Logger.debug(
                        `[${specString}]: Expect typechecking of ${parsed.pp()} in ctx ${pp(
                            ctx.scopes as PPIsh
                        )} to throw`
                    );

                    expect(() => tcAnnotation(parsed, ctx, target, typeEnv)).toThrow();
                });
            }
        });
    }
});
