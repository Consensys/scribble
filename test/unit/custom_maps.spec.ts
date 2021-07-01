import expect from "expect";
import {
    AddressType,
    ArrayType,
    ASTContext,
    ASTNodeFactory,
    ASTWriter,
    BoolType,
    BytesType,
    compileSourceString,
    DefaultASTWriterMapping,
    forAll,
    IntType,
    PrettyFormatter,
    SourceUnit,
    StringType,
    StructDefinition,
    TypeNode,
    UserDefinedType,
    VariableDeclaration
} from "solc-typed-ast";
import { generateMapLibrary, generateUtilsContract, interposeMap } from "../../src";
import { single } from "../../src/util";
import { toAst } from "../integration/utils";
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
    let version: string;
    let writer: ASTWriter;

    before("", () => {
        const res = toAst("sample.sol", content);
        unit = single(res.units);
        ctx = res.reader.context;
        version = res.compilerVersion;

        writer = new ASTWriter(DefaultASTWriterMapping, new PrettyFormatter(4, 0), version);
    });

    for (const [keyT, valueArg] of testTypes) {
        it(`Can generate compiling map library for ${keyT.pp()}->${
            valueArg instanceof TypeNode ? valueArg.pp() : "?"
        }`, () => {
            const factory = new ASTNodeFactory(ctx);
            const valueT = valueArg instanceof TypeNode ? valueArg : valueArg(unit);
            const lib = generateMapLibrary(factory, keyT, valueT, unit, version);

            const src = writer.write(lib);
            const newContent = content + "\n" + src;

            console.error(newContent);
            const compRes = compileSourceString("foo.sol", newContent, version, []);

            expect(compRes.data.contracts["foo.sol"]).toBeDefined();
            expect(compRes.data.contracts["foo.sol"][lib.name]).toBeDefined();
            expect(forAll(compRes.data.errors, (error: any) => error.severity === "warning"));
        });
    }
});

const interposingTests: Array<[string, string, Array<[string, Array<string | null>]>]> = [
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
    }
}
`,
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
    }
}
`,
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
        assert(z[3][0] == 42);
    }
}
`,
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

        x[1].pop();
        assert(x[1].length == 3);

        uint[] memory a = new uint[](3);
        a[0] = 2; a[1] = 4; a[2] = 6;
        x[2] = a;
        assert(x[2].length == 3 && x[2][2] == 6);
    }
}
`,
        [["x", []]]
    ]
    // @todo test with a state var where some parts should be interposed, and some shouldn't be interposed
    // @todo test with a state var with a struct, containing a map, with an inline initializer
];

describe("Interposing on a map", () => {
    for (const [name, sample, svs] of interposingTests) {
        it(`Can interpose on map in sample ${name}`, () => {
            const res = toAst(name, sample);
            const unit = single(res.units);
            const ctx = res.reader.context;
            const version = res.compilerVersion;
            const factory = new ASTNodeFactory(ctx);
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

            const targets: Array<
                [VariableDeclaration, Array<string | null>]
            > = svs.map(([svName, path]) => [
                single(contract.vStateVariables.filter((v) => v.name == svName)),
                path
            ]);

            interposeMap(instrCtx, targets, [unit]);

            const newContent = [unit, instrCtx.utilsUnit]
                .map((unit) => writer.write(unit))
                .join("\n");
            console.error(newContent);
            const compRes = compileSourceString("foo.sol", newContent, version, []);

            expect(compRes.data.contracts["foo.sol"]).toBeDefined();
            expect(forAll(compRes.data.errors, (error: any) => error.severity === "warning"));
        });
    }
});
