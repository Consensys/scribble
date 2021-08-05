import expect from "expect";
import {
    AddressType,
    ArrayType,
    ASTContext,
    ASTWriter,
    BoolType,
    BytesType,
    compileSourceString,
    DataLocation,
    DefaultASTWriterMapping,
    forAll,
    IntType,
    PointerType,
    PrettyFormatter,
    SourceUnit,
    StringType,
    StructDefinition,
    TypeNode,
    UserDefinedType,
    VariableDeclaration
} from "solc-typed-ast";
import { generateUtilsContract, interposeMap, ScribbleFactory } from "../../src";
import { InstrumentationContext } from "../../src/instrumenter/instrumentation_context";
import { pp, single } from "../../src/util";
import { toAst } from "../integration/utils";
import { Config, executeTestSuiteInternal } from "../integration/vm";
import { makeInstrumentationCtx } from "./utils";

const libGenTests: [string, Array<[TypeNode, TypeNode | ((s: SourceUnit) => TypeNode)]>] = [
    `
pragma solidity 0.8.4;
struct Foo {
    uint x;
}

struct Bar {
    mapping(uint => uint) t;
}
`,
    [
        [new IntType(256, false), new IntType(8, true)],
        [new IntType(256, false), new StringType()],
        [new StringType(), new StringType()],
        [new StringType(), new BytesType()],
        [new BytesType(), new ArrayType(new AddressType(true))],
        [new BytesType(), new ArrayType(new BoolType(), BigInt(3))],
        [
            new AddressType(true),
            (s: SourceUnit) =>
                new UserDefinedType(
                    "Foo",
                    single(
                        s.getChildrenBySelector(
                            (child) => child instanceof StructDefinition && child.name === "Foo"
                        )
                    ) as StructDefinition
                )
        ]
    ]
];

describe("Maps with keys library generation", () => {
    const [content, testTypes] = libGenTests;
    let unit: SourceUnit;
    let ctx: ASTContext;
    let factory: ScribbleFactory;
    let version: string;
    let writer: ASTWriter;
    let instrCtx: InstrumentationContext;

    before("", () => {
        const res = toAst("sample.sol", content);
        unit = single(res.units);
        ctx = res.reader.context;
        version = res.compilerVersion;
        factory = new ScribbleFactory(ctx);
        instrCtx = makeInstrumentationCtx(res.units, factory, res.files, "log", version);

        writer = new ASTWriter(DefaultASTWriterMapping, new PrettyFormatter(4, 0), version);
    });

    for (const [keyT, valueArg] of testTypes) {
        it(`Can generate compiling map library for ${keyT.pp()}->${
            valueArg instanceof TypeNode ? valueArg.pp() : "?"
        }`, () => {
            const valueT = valueArg instanceof TypeNode ? valueArg : valueArg(unit);

            const lib = instrCtx.typesToLibraryMap.get(keyT, valueT);
            instrCtx.libToMapGetterMap.get(lib, true);
            instrCtx.libToMapGetterMap.get(lib, false);
            instrCtx.libToMapSetterMap.get(
                lib,
                valueT instanceof ArrayType ? new PointerType(valueT, DataLocation.Memory) : valueT
            );
            instrCtx.libToDeleteFunMap.get(lib);
            if (valueT instanceof IntType) {
                instrCtx.libToMapIncDecMap.get(lib, "++", false, false);
                instrCtx.libToMapIncDecMap.get(lib, "++", true, true);
                instrCtx.libToMapIncDecMap.get(lib, "--", false, true);
                instrCtx.libToMapIncDecMap.get(lib, "--", true, false);
            }

            const src = writer.write(lib);
            const newContent = content + "\n" + src;

            const compRes = compileSourceString("foo.sol", newContent, version, []);

            expect(compRes.data.contracts["foo.sol"]).toBeDefined();
            expect(compRes.data.contracts["foo.sol"][lib.name]).toBeDefined();
            expect(forAll(compRes.data.errors, (error: any) => error.severity === "warning"));
        });
    }
});

const interposingTests: Array<[string, string, string, Array<[string, Array<string | null>]>]> = [
    [
        "Maps with simple assignments",
        `
pragma solidity 0.8.4;
contract Foo {
    mapping(uint => uint) x;
    function main() public {
        uint a;
        x[0] = 1;
        assert(x[0] == 1);
        x[1] = a = 2;
        assert(x[1] == 2);
        //@todo uncomment
        x[3] = x[2] = 1;


        assert(1 == x[0]++ && x[0] == 2);
        assert(3 == ++x[0] && x[0] == 3);
        assert(2 == --x[0] && x[0] == 2);
        assert(2 == x[0]-- && x[0] == 1);


        delete x[3];
        assert(x[3] == 0);

        x[3] += 5;
        assert(x[3] == 5);
        x[3] *= 2;
        assert(x[3] == 10);
        x[3] /= 2;
        assert(x[3] == 5);
        x[3] %= 3; 
        assert(x[3] == 2);
        x[3] <<= 2;
        
        assert(x[3] == 8);
        x[3] >>= 2;
        assert(x[3] == 2);
    }
}
`,
        `pragma solidity 0.8.4;

contract Foo {
    uint256_to_uint256.S internal x;

    function main() public {
        uint a;
        uint256_to_uint256.set(x, 0, 1);
        assert(uint256_to_uint256.get(x, 0) == 1);
        uint256_to_uint256.set(x, 1, a = 2);
        assert(uint256_to_uint256.get(x, 1) == 2);
        uint256_to_uint256.set(x, 3, uint256_to_uint256.set(x, 2, 1));
        assert((1 == uint256_to_uint256.inc(x, 0)) && (uint256_to_uint256.get(x, 0) == 2));
        assert((3 == uint256_to_uint256.inc_pre(x, 0)) && (uint256_to_uint256.get(x, 0) == 3));
        assert((2 == uint256_to_uint256.dec_pre(x, 0)) && (uint256_to_uint256.get(x, 0) == 2));
        assert((2 == uint256_to_uint256.dec(x, 0)) && (uint256_to_uint256.get(x, 0) == 1));
        uint256_to_uint256.deleteKey(x, 3);
        assert(uint256_to_uint256.get(x, 3) == 0);
        uint256_to_uint256.set(x, 3, uint256_to_uint256.get(x, 3) + 5);
        assert(uint256_to_uint256.get(x, 3) == 5);
        uint256_to_uint256.set(x, 3, uint256_to_uint256.get(x, 3) * 2);
        assert(uint256_to_uint256.get(x, 3) == 10);
        uint256_to_uint256.set(x, 3, uint256_to_uint256.get(x, 3) / 2);
        assert(uint256_to_uint256.get(x, 3) == 5);
        uint256_to_uint256.set(x, 3, uint256_to_uint256.get(x, 3) % 3);
        assert(uint256_to_uint256.get(x, 3) == 2);
        uint256_to_uint256.set(x, 3, uint256_to_uint256.get(x, 3) << 2);
        assert(uint256_to_uint256.get(x, 3) == 8);
        uint256_to_uint256.set(x, 3, uint256_to_uint256.get(x, 3) >> 2);
        assert(uint256_to_uint256.get(x, 3) == 2);
    }
}`,
        [["x", []]]
    ],
    [
        "Map index in the index location",
        `
pragma solidity 0.8.4;
contract Foo {
    mapping(uint => uint) x;
    function main() public {
        uint a;
        x[0] = 1;
        x[1] = 2;
        assert(x[0] == 1);
        assert(x[x[0]] == 2);
        x[x[0] = x[0] + 1] = x[0] + 2;
        assert(x[2] == 3);
    }
}
`,
        `pragma solidity 0.8.4;

contract Foo {
    uint256_to_uint256.S internal x;

    function main() public {
        uint a;
        uint256_to_uint256.set(x, 0, 1);
        uint256_to_uint256.set(x, 1, 2);
        assert(uint256_to_uint256.get(x, 0) == 1);
        assert(uint256_to_uint256.get(x, uint256_to_uint256.get(x, 0)) == 2);
        uint256_to_uint256.set(x, uint256_to_uint256.set(x, 0, uint256_to_uint256.get(x, 0) + 1), uint256_to_uint256.get(x, 0) + 2);
        assert(uint256_to_uint256.get(x, 2) == 3);
    }
}`,
        [["x", []]]
    ],
    [
        "Both maps that should and shouldn't be replaced",
        `
pragma solidity 0.8.4;
contract Foo {
    mapping(uint => uint) x;
    mapping(uint => uint) y;

    function main() public {
        uint a;
        x[0] = 1;
        x[1] = 2;
        assert(x[0] == 1);
        assert(x[x[0]] == 2);

        y[0] = 1;
        y[1] = 2;

        assert(y[0] == 1);
        assert(y[x[0]] == 2);
        assert(x[y[0]] == 2);
    }
}
`,
        `pragma solidity 0.8.4;

contract Foo {
    uint256_to_uint256.S internal x;
    mapping(uint => uint) internal y;

    function main() public {
        uint a;
        uint256_to_uint256.set(x, 0, 1);
        uint256_to_uint256.set(x, 1, 2);
        assert(uint256_to_uint256.get(x, 0) == 1);
        assert(uint256_to_uint256.get(x, uint256_to_uint256.get(x, 0)) == 2);
        y[0] = 1;
        y[1] = 2;
        assert(y[0] == 1);
        assert(y[uint256_to_uint256.get(x, 0)] == 2);
        assert(uint256_to_uint256.get(x, y[0]) == 2);
    }
}`,
        [["x", []]]
    ],
    [
        "Nested mappings",
        `
pragma solidity 0.8.4;
contract Foo {
    mapping(uint => mapping(address => bool)) x;
    mapping(uint => mapping(bool => string)) y;
    mapping(uint => mapping(int8 => uint)) z;
    mapping(uint => uint) w;

    function main() public {
        x[0][address(0x0)] = true;
        bool t = x[0][address(0x0)];
        x[1][address(0x1)] = x[0][address(0x0)];

        y[1][false] = "hi";
        y[2][true] = y[1][false];
        assert(keccak256(bytes(y[2][true])) == keccak256(bytes("hi")));
        
        z[0][1] = 1;
        z[z[0][1]][2] = 2;
        
        assert(z[1][2] == 2);

        z[w[0] = w[1] + 3][int8(uint8(w[2]))] = 42;
        assert(w[0] == 3 && z[3][0] == 42);
    }
}
`,
        `pragma solidity 0.8.4;

contract Foo {
    mapping(uint => address_to_bool.S) internal x;
    uint256_to_mapping_bool_to_string.S internal y;
    uint256_to_int8_to_uint256_S_354.S internal z;
    uint256_to_uint256.S internal w;

    function main() public {
        address_to_bool.set(x[0], address(0x0), true);
        bool t = address_to_bool.get(x[0], address(0x0));
        address_to_bool.set(x[1], address(0x1), address_to_bool.get(x[0], address(0x0)));
        uint256_to_mapping_bool_to_string.get_lhs(y, 1)[false] = "hi";
        uint256_to_mapping_bool_to_string.get_lhs(y, 2)[true] = uint256_to_mapping_bool_to_string.get(y, 1)[false];
        assert(keccak256(bytes(uint256_to_mapping_bool_to_string.get(y, 2)[true])) == keccak256(bytes("hi")));
        int8_to_uint256.set(uint256_to_int8_to_uint256_S_354.get_lhs(z, 0), 1, 1);
        int8_to_uint256.set(uint256_to_int8_to_uint256_S_354.get_lhs(z, int8_to_uint256.get(uint256_to_int8_to_uint256_S_354.get(z, 0), 1)), 2, 2);
        assert(int8_to_uint256.get(uint256_to_int8_to_uint256_S_354.get(z, 1), 2) == 2);
        int8_to_uint256.set(uint256_to_int8_to_uint256_S_354.get_lhs(z, uint256_to_uint256.set(w, 0, uint256_to_uint256.get(w, 1) + 3)), int8(uint8(uint256_to_uint256.get(w, 2))), 42);
        assert((uint256_to_uint256.get(w, 0) == 3) && (int8_to_uint256.get(uint256_to_int8_to_uint256_S_354.get(z, 3), 0) == 42));
    }
}`,
        [
            ["x", [null]],
            ["y", []],
            ["z", []],
            ["z", [null]],
            ["w", []]
        ]
    ],
    [
        "Maps with arrays",
        `
pragma solidity 0.8.4;
contract Foo {
    mapping(uint => uint[]) x;

    function main() public {
        x[0] = [1,2,3];
        assert(x[0].length == 3);

        x[1] = x[0];
        x[1].push(4);
        assert(x[1].length == 4 && x[1][3] == 4);

        x[1][1] = 10;
        assert(x[1][1] == 10);

        x[1].pop();
        assert(x[1].length == 3);

        uint[] memory a = new uint[](3);
        a[0] = 2; a[1] = 4; a[2] = 6;
        x[2] = a;
        assert(x[2].length == 3 && x[2][2] == 6);
    }
}
`,
        `pragma solidity 0.8.4;

contract Foo {
    uint256_to_uint256_arr.S internal x;

    function main() public {
        uint256_to_uint256_arr.set_uint8_arr_3(x, 0, [1, 2, 3]);
        assert(uint256_to_uint256_arr.get(x, 0).length == 3);
        uint256_to_uint256_arr.set(x, 1, uint256_to_uint256_arr.get(x, 0));
        uint256_to_uint256_arr.get_lhs(x, 1).push(4);
        assert((uint256_to_uint256_arr.get(x, 1).length == 4) && (uint256_to_uint256_arr.get(x, 1)[3] == 4));
        uint256_to_uint256_arr.get_lhs(x, 1)[1] = 10;
        assert(uint256_to_uint256_arr.get(x, 1)[1] == 10);
        uint256_to_uint256_arr.get_lhs(x, 1).pop();
        assert(uint256_to_uint256_arr.get(x, 1).length == 3);
        uint[] memory a = new uint[](3);
        a[0] = 2;
        a[1] = 4;
        a[2] = 6;
        uint256_to_uint256_arr.set(x, 2, a);
        assert((uint256_to_uint256_arr.get(x, 2).length == 3) && (uint256_to_uint256_arr.get(x, 2)[2] == 6));
    }
}`,
        [["x", []]]
    ],
    [
        "Partial state var update",
        `
pragma solidity 0.8.4;
contract Foo {
    struct Moo {
        mapping(uint => uint[]) x;
        mapping(uint => uint[]) y;
    }

    Moo m;

    function main() public {
        m.y[0] = [1,2,3];
        assert(m.y[0].length == 3);

        m.x[1] = m.y[0];
        m.x[1].push(4);
        assert(m.x[1].length == 4 && m.x[1][3] == 4);

        m.x[1].pop();
        assert(m.x[1].length == 3);

        uint[] memory a = new uint[](3);
        a[0] = 2; a[1] = 4; a[2] = 6;
        m.x[2] = a;
        assert(m.x[2].length == 3 && m.x[2][2] == 6);
    }
}
`,
        `pragma solidity 0.8.4;

contract Foo {
    struct Moo {
        uint256_to_uint256_arr.S x;
        mapping(uint => uint[]) y;
    }

    Moo internal m;

    function main() public {
        m.y[0] = [1, 2, 3];
        assert(m.y[0].length == 3);
        uint256_to_uint256_arr.set(m.x, 1, m.y[0]);
        uint256_to_uint256_arr.get_lhs(m.x, 1).push(4);
        assert((uint256_to_uint256_arr.get(m.x, 1).length == 4) && (uint256_to_uint256_arr.get(m.x, 1)[3] == 4));
        uint256_to_uint256_arr.get_lhs(m.x, 1).pop();
        assert(uint256_to_uint256_arr.get(m.x, 1).length == 3);
        uint[] memory a = new uint[](3);
        a[0] = 2;
        a[1] = 4;
        a[2] = 6;
        uint256_to_uint256_arr.set(m.x, 2, a);
        assert((uint256_to_uint256_arr.get(m.x, 2).length == 3) && (uint256_to_uint256_arr.get(m.x, 2)[2] == 6));
    }
}`,
        [["m", ["x"]]]
    ],
    [
        "Public vars",
        `
pragma solidity 0.8.4;
contract Foo {
    enum E { A, B, C }
    mapping (uint => uint) public x;
    mapping (uint => mapping(uint => uint)) public y;
    mapping (string => uint[]) public z;
    mapping (bytes => E) public u;

    function main() public {
        x[2] = 5;
        assert(x[2] == 5);
        y[0][1] = 6;
        assert(y[0][1] == 6);
        x[1] = y[0][1] + x[2];
        assert(x[1] == 11);
        z["hi"] = [1,2,3];
        assert(z["hi"].length == 3 && z["hi"][2] == 3);
        u[hex"abcd"] = E.A;
        assert(u[hex"abcd"] == E.A);
    }
}
`,
        `pragma solidity 0.8.4;

contract Foo {
    enum E { A, B, C }

    uint256_to_uint256.S x0;
    uint256_to_uint256_to_uint256_S_141.S y0;
    string_to_uint256_arr.S z0;
    bytes_to_Foo_E_5.S u0;

    function main() public {
        uint256_to_uint256.set(x0, 2, 5);
        assert(uint256_to_uint256.get(x0, 2) == 5);
        uint256_to_uint256.set(uint256_to_uint256_to_uint256_S_141.get_lhs(y0, 0), 1, 6);
        assert(uint256_to_uint256.get(uint256_to_uint256_to_uint256_S_141.get(y0, 0), 1) == 6);
        uint256_to_uint256.set(x0, 1, uint256_to_uint256.get(uint256_to_uint256_to_uint256_S_141.get(y0, 0), 1) + uint256_to_uint256.get(x0, 2));
        assert(uint256_to_uint256.get(x0, 1) == 11);
        string_to_uint256_arr.set_uint8_arr_3(z0, "hi", [1, 2, 3]);
        assert((string_to_uint256_arr.get(z0, "hi").length == 3) && (string_to_uint256_arr.get(z0, "hi")[2] == 3));
        bytes_to_Foo_E_5.set(u0, hex"abcd", E.A);
        assert(bytes_to_Foo_E_5.get(u0, hex"abcd") == E.A);
    }

    function y(uint256 ARG_0, uint256 ARG_1) public returns (uint256 RET_0) {
        return uint256_to_uint256.get(uint256_to_uint256_to_uint256_S_141.get(y0, ARG_0), ARG_1);
    }

    function x(uint256 ARG_2) public returns (uint256 RET_1) {
        return uint256_to_uint256.get(x0, ARG_2);
    }

    function z(string memory ARG_3, uint256 ARG_4) public returns (uint256 RET_2) {
        return string_to_uint256_arr.get(z0, ARG_3)[ARG_4];
    }

    function u(bytes memory ARG_5) public returns (Foo.E RET_3) {
        return bytes_to_Foo_E_5.get(u0, ARG_5);
    }
}`,
        [
            ["x", []],
            ["y", []],
            ["y", [null]],
            ["z", []],
            ["u", []]
        ]
    ]
];

describe("Interposing on a map", () => {
    for (const [name, sample, expectedInstrCode, svs] of interposingTests) {
        let instrCode: string;
        let newContent: string;
        let version: string;

        it(`Code compiles after interposing on ${pp(svs)} in sample ${name}`, () => {
            const res = toAst(name, sample);
            const unit = single(res.units);
            const ctx = res.reader.context;

            version = res.compilerVersion;

            const factory = new ScribbleFactory(ctx);
            const instrCtx = makeInstrumentationCtx(
                [unit],
                factory,
                new Map([[name, sample]]),
                "log",
                version
            );

            const writer: ASTWriter = new ASTWriter(
                DefaultASTWriterMapping,
                new PrettyFormatter(4, 0),
                version
            );

            const contract = single(unit.vContracts);

            generateUtilsContract(
                factory,
                "__scribble_ReentrancyUtils.sol",
                "__scribble_ReentrancyUtils.sol",
                version,
                instrCtx
            );

            const targets: Array<[VariableDeclaration, Array<string | null>]> = svs.map(
                ([svName, path]) => [
                    single(contract.vStateVariables.filter((v) => v.name == svName)),
                    path
                ]
            );

            interposeMap(instrCtx, targets, [unit]);

            instrCode = writer.write(unit);
            newContent = [unit, instrCtx.utilsUnit].map((unit) => writer.write(unit)).join("\n");
            const compRes = compileSourceString("foo.sol", newContent, version, []);

            expect(compRes.data.contracts["foo.sol"]).toBeDefined();
            expect(forAll(compRes.data.errors, (error: any) => error.severity === "warning"));
        });

        it(`Interposed code matches expected in sample ${name}`, () => {
            expect(instrCode).toEqual(expectedInstrCode);
        });

        it(`Interposed code executes successfully in sample ${name}`, () => {
            const cfg: Config = {
                file: "sample.sol",
                contents: newContent,
                steps: [
                    {
                        act: "createUser",
                        alias: "owner",
                        options: {
                            balance: 1000e18
                        }
                    },
                    {
                        act: "deployContract",
                        contract: "Foo",
                        user: "owner",
                        alias: "instance1"
                    },
                    {
                        act: "txCall",
                        user: "owner",
                        contract: "instance1",

                        method: "main"
                    }
                ]
            };

            executeTestSuiteInternal("foo.json", cfg, version);
        });
    }
});
