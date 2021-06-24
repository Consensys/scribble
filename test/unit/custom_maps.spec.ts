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
    UserDefinedType
} from "solc-typed-ast";
import { generateMapLibrary } from "../../src";
import { single } from "../../src/util";
import { toAst } from "../integration/utils";

const tests: [string, Array<[TypeNode, TypeNode | ((s: SourceUnit) => TypeNode)]>] = [
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
    const [content, testTypes] = tests;
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
