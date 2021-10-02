import { parseAnnotation, parseExpression as parse } from "../../src/spec-lang/expr_parser";
import expect from "expect";
import { eq } from "../../src/util/struct_equality";
import { SProperty, AnnotationType } from "../../src/spec-lang/ast";
import {
    BoolType,
    ContractDefinition,
    FunctionDefinition,
    getABIEncoderVersion,
    IntLiteralType,
    IntType,
    SourceUnit,
    StringLiteralType,
    TypeNode
} from "solc-typed-ast";
import { getTarget, LocationDesc, toAst } from "../integration/utils";
import { tc, SemInfo, SemError, TypeEnv, tcAnnotation, scAnnotation } from "../../src/spec-lang/tc";
import { sc } from "../../src/spec-lang/tc";
import { Logger } from "../../src/logger";
import { getTypeCtxAndTarget } from "../integration/utils";

describe("SemanticChecker Expression Unit Tests", () => {
    const goodSamples: Array<[string, string, Array<[string, LocationDesc, TypeNode, SemInfo]>]> = [
        [
            "foo.sol",
            `pragma solidity 0.6.0;

            contract Foo {
                uint sV;
                uint i;
                int128 constant sV1 = -1;
                int32[] sI32Arr;
                uint[] arr;
                mapping(string => uint) m1;
                mapping(bytes => mapping(address => int8)) m2;

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
                    "forall (uint i in sI32Arr) i > 0",
                    ["Foo", "pId"],
                    new BoolType(),
                    { isOld: false, isConst: false, canFail: false }
                ],
                [
                    "forall (uint i in 1...10) true",
                    ["Foo", "pId"],
                    new BoolType(),
                    { isOld: false, isConst: true, canFail: false }
                ],
                [
                    "forall (uint i in 1...10) let i := uint(10) in old(i) > 100",
                    ["Foo", "pId"],
                    new BoolType(),
                    { isOld: false, isConst: true, canFail: false }
                ],
                [
                    "old(forall (uint i in sI32Arr) i > 0)",
                    ["Foo", "pId"],
                    new BoolType(),
                    { isOld: true, isConst: false, canFail: false }
                ],
                [
                    "forall (uint i in 1...10) let i := uint(10) in old(sV) > 100",
                    ["Foo", "pId"],
                    new BoolType(),
                    { isOld: false, isConst: false, canFail: false }
                ],
                [
                    "forall (string memory s in m1) m1[s] > 0",
                    ["Foo"],
                    new BoolType(),
                    { isOld: false, isConst: false, canFail: true }
                ],
                [
                    "forall (bytes memory b in m2) forall(address a in m2[b]) m2[b][a] > 0",
                    ["Foo"],
                    new BoolType(),
                    { isOld: false, isConst: false, canFail: true }
                ],
                ["true", ["Foo"], new BoolType(), { isOld: false, isConst: true, canFail: false }],
                [
                    "old(true)",
                    ["Foo", "add"],
                    new BoolType(),
                    { isOld: false, isConst: true, canFail: false }
                ],
                [
                    "1",
                    ["Foo"],
                    new IntLiteralType(),
                    { isOld: false, isConst: true, canFail: false }
                ],
                [
                    "hex'0011ff'",
                    ["Foo"],
                    new StringLiteralType("0011ff", true),
                    { isOld: false, isConst: true, canFail: false }
                ],
                [
                    'hex""',
                    ["Foo"],
                    new StringLiteralType("", true),
                    { isOld: false, isConst: true, canFail: false }
                ],
                [
                    '"abc \\" \\u0000 \\x01 Def "',
                    ["Foo"],
                    new StringLiteralType('abc " \u0000 \x01 Def ', false),
                    { isOld: false, isConst: true, canFail: false }
                ],
                [
                    "''",
                    ["Foo"],
                    new StringLiteralType("", false),
                    { isOld: false, isConst: true, canFail: false }
                ],
                [
                    "1e10",
                    ["Foo"],
                    new IntLiteralType(),
                    { isOld: false, isConst: true, canFail: false }
                ],
                [
                    "10e+5",
                    ["Foo"],
                    new IntLiteralType(),
                    { isOld: false, isConst: true, canFail: false }
                ],
                [
                    "1000e-2",
                    ["Foo"],
                    new IntLiteralType(),
                    { isOld: false, isConst: true, canFail: false }
                ],
                [
                    "old(1)",
                    ["Foo", "add"],
                    new IntLiteralType(),
                    { isOld: false, isConst: true, canFail: false }
                ],
                [
                    "sV",
                    ["Foo"],
                    new IntType(256, false),
                    { isOld: false, isConst: false, canFail: false }
                ],
                [
                    "sV1",
                    ["Foo"],
                    new IntType(128, true),
                    { isOld: false, isConst: true, canFail: false }
                ],
                [
                    "old(sV1)",
                    ["Foo", "add"],
                    new IntType(128, true),
                    { isOld: false, isConst: true, canFail: false }
                ],
                [
                    "x",
                    ["Foo", "add"],
                    new IntType(8, true),
                    { isOld: false, isConst: false, canFail: false }
                ],
                [
                    "old(x)",
                    ["Foo", "add"],
                    new IntType(8, true),
                    { isOld: true, isConst: false, canFail: false }
                ],
                [
                    "add",
                    ["Foo", "add"],
                    new IntType(64, false),
                    { isOld: false, isConst: false, canFail: false }
                ],
                [
                    "x+x",
                    ["Foo", "add"],
                    new IntType(8, true),
                    { isOld: false, isConst: false, canFail: false }
                ],
                [
                    "x/x",
                    ["Foo", "add"],
                    new IntType(8, true),
                    { isOld: false, isConst: false, canFail: true }
                ],
                [
                    "old(x % x)",
                    ["Foo", "add"],
                    new IntType(8, true),
                    { isOld: true, isConst: false, canFail: true }
                ],
                [
                    "sI32Arr[1]",
                    ["Foo"],
                    new IntType(32, true),
                    { isOld: false, isConst: false, canFail: true }
                ],
                [
                    "old(sI32Arr[1])",
                    ["Foo", "add"],
                    new IntType(32, true),
                    { isOld: true, isConst: false, canFail: true }
                ],
                [
                    "let x := uint(1) in old(x)",
                    ["Foo", "add"],
                    new IntType(256, false),
                    { isOld: false, isConst: true, canFail: false }
                ],
                [
                    "let x := y in x",
                    ["Foo", "add"],
                    new IntType(64, false),
                    { isOld: false, isConst: false, canFail: false }
                ],
                [
                    "let x := old(y) in old(x)",
                    ["Foo", "add"],
                    new IntType(64, false),
                    { isOld: true, isConst: false, canFail: false }
                ],
                [
                    "let x := old(y) in let z := uint64(1) in old(x+z)",
                    ["Foo", "add"],
                    new IntType(64, false),
                    { isOld: true, isConst: false, canFail: false }
                ],
                [
                    "let z := old(uint64(x)) in let x := old(y) in old(x+y)",
                    ["Foo", "add"],
                    new IntType(64, false),
                    { isOld: true, isConst: false, canFail: false }
                ],
                [
                    "let z := old(uint64(x)) in old(let x := y in x+y)",
                    ["Foo", "add"],
                    new IntType(64, false),
                    { isOld: true, isConst: false, canFail: false }
                ],
                [
                    "old(let x := y in x)",
                    ["Foo", "add"],
                    new IntType(64, false),
                    { isOld: true, isConst: false, canFail: false }
                ],
                [
                    "pId(x)",
                    ["Foo", "add"],
                    new IntType(8, true),
                    { isOld: false, isConst: false, canFail: true }
                ],
                [
                    "vId()",
                    ["Foo", "add"],
                    new IntType(256, false),
                    { isOld: false, isConst: false, canFail: true }
                ],
                [
                    "$result",
                    ["Foo", "add"],
                    new IntType(64, false),
                    { isOld: false, isConst: false, canFail: false }
                ],
                [
                    "unchecked_sum(m1)",
                    ["Foo"],
                    new IntType(256, false),
                    { isOld: false, isConst: false, canFail: false }
                ],
                [
                    "unchecked_sum(old(m1))",
                    ["Foo", "add"],
                    new IntType(256, false),
                    { isOld: true, isConst: false, canFail: false }
                ],
                [
                    "old(unchecked_sum(m1))",
                    ["Foo", "add"],
                    new IntType(256, false),
                    { isOld: true, isConst: false, canFail: false }
                ],
                [
                    "forall (string memory s in m1) m1[s] > 0",
                    ["Foo", "add"],
                    new BoolType(),
                    { isOld: false, isConst: false, canFail: true }
                ],
                [
                    "old(forall (string memory s in m1) m1[s] > 0)",
                    ["Foo", "add"],
                    new BoolType(),
                    { isOld: true, isConst: false, canFail: true }
                ],
                [
                    "forall (string memory s in old(m1)) old(m1[s] > 0)",
                    ["Foo", "add"],
                    new BoolType(),
                    { isOld: true, isConst: false, canFail: true }
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
                uint[] arr;
                mapping(uint => uint) m;

                function vId() public returns (uint) {
                    return sV;
                }

                function add(uint8 x, uint64 y) public returns (uint64 add) {
                    return uint64(x)+y;
                }
            }`,
            [
                ["forall(uint x in 1...10) arr[x] > 10 + old(x*sV+100)", ["Foo", "add"]],
                ["forall(uint x in 1...10) arr[0] > 10 + old(x)", ["Foo", "add"]],
                ["forall(uint x in 1...old(y)) old(x > 0)", ["Foo", "add"]],
                ["old(old(x))", ["Foo", "add"]],
                ["let x := y in old(x)", ["Foo", "add"]],
                ["let x := y in let z := uint(old(1)) in old(x+z)", ["Foo", "add"]],
                ["vId()", ["Foo", "add"]],
                ["old($result)", ["Foo", "add"]],
                ["old(7)", ["Foo"]]
            ]
        ]
    ];

    for (const [fileName, content, testCases] of goodSamples) {
        describe(`Positive tests for #${fileName}`, () => {
            let units: SourceUnit[];

            before(() => {
                const result = toAst(fileName, content);

                units = result.units;
            });

            for (const [specString, loc, expectedType, expectedInfo] of testCases) {
                it(`SemCheck for ${specString} returns ${JSON.stringify(expectedInfo)}`, () => {
                    const compilerVersion = "0.6.0";
                    const encoderVer = getABIEncoderVersion(units, compilerVersion);
                    const [ctx, target] = getTypeCtxAndTarget(loc, units, compilerVersion);
                    const parsed = parse(specString, target, compilerVersion);
                    const annotationType =
                        target instanceof ContractDefinition
                            ? AnnotationType.Invariant
                            : target instanceof FunctionDefinition
                            ? AnnotationType.IfSucceeds
                            : AnnotationType.IfUpdated;

                    const annotation = new SProperty(annotationType, parsed);
                    const typeEnv = new TypeEnv(compilerVersion, encoderVer);
                    const type = tc(parsed, ctx, typeEnv);
                    expect(eq(type, expectedType)).toEqual(true);
                    const semInfo = sc(
                        parsed,
                        {
                            isOld: false,
                            annotation,
                            interposingQueue: [],
                            annotationTarget: target
                        },
                        typeEnv
                    );
                    Logger.debug(`[${parsed.pp()}] sem info: ${JSON.stringify(semInfo)}`);
                    expect(eq(semInfo, expectedInfo)).toEqual(true);
                });
            }
        });
    }

    for (const [fileName, content, testCases] of badSamples) {
        describe(`Negative tests for #${fileName}`, () => {
            let units: SourceUnit[];

            before(() => {
                const result = toAst(fileName, content);

                units = result.units;
            });

            for (const [specString, loc] of testCases) {
                it(`SemCheck for ${specString} throws SemError`, () => {
                    const compilerVersion = "0.6.0";
                    const encoderVer = getABIEncoderVersion(units, compilerVersion);
                    const [ctx, target] = getTypeCtxAndTarget(loc, units, compilerVersion);
                    const parsed = parse(specString, target, compilerVersion);
                    const annotationType =
                        target instanceof ContractDefinition
                            ? AnnotationType.Invariant
                            : target instanceof FunctionDefinition
                            ? AnnotationType.IfSucceeds
                            : AnnotationType.IfUpdated;
                    const annotation = new SProperty(annotationType, parsed);
                    // Type-checking should succeed
                    const typeEnv = new TypeEnv(compilerVersion, encoderVer);
                    tc(parsed, ctx, typeEnv);
                    expect(
                        sc.bind(
                            sc,
                            parsed,
                            {
                                isOld: false,
                                annotation,
                                interposingQueue: [],
                                annotationTarget: target
                            },
                            typeEnv
                        )
                    ).toThrowError(SemError as any);
                });
            }
        });
    }
});

describe("SemanticChecker Annotation Unit Tests", () => {
    const goodSamples: Array<[string, string, Array<[string, LocationDesc]>]> = [
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
                ["define foo(uint x) uint = x + sV;", ["Foo"]],
                ["if_updated old(sV) < sV;", ["Foo", "sV"]],
                ["if_assigned old(sV) < sV;", ["Foo", "sV"]],
                ["if_succeeds old(y) + y > add;", ["Foo", "add"]],
                ["invariant sV > 0;", ["Foo"]],
                ["assert x> 0 && y < 10 && sV > 1;", ["Foo", "add", "//Block/*[1]"]]
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
                ["if_succeeds old(old(x)) > 0;", ["Foo", "add"]],
                ["if_succeeds let x := y in old(x) > 0;", ["Foo", "add"]],
                ["invariant old(sV) > 0;", ["Foo"]],
                ["define foo(uint x) uint = old(x);", ["Foo"]],
                ["define foo() uint = old(sV);", ["Foo"]],
                ["assert old(x) > 0;", ["Foo", "add", "//Block/*[1]"]]
            ]
        ]
    ];

    for (const [fileName, content, testCases] of goodSamples) {
        describe(`Positive tests for #${fileName}`, () => {
            let units: SourceUnit[];

            before(() => {
                const result = toAst(fileName, content);

                units = result.units;
            });

            for (const [specString, loc] of testCases) {
                it(`SemCheck for ${specString} succeeds`, () => {
                    const compilerVersion = "0.6.0";
                    const encoderVer = getABIEncoderVersion(units, compilerVersion);
                    const target = getTarget(loc, units);
                    const annotation = parseAnnotation(specString, target, compilerVersion);
                    const [ctx] = getTypeCtxAndTarget(loc, units, compilerVersion, annotation);
                    const typeEnv = new TypeEnv(compilerVersion, encoderVer);
                    tcAnnotation(annotation, ctx, target, typeEnv);
                    scAnnotation(annotation, typeEnv, new Map(), {
                        isOld: false,
                        annotation,
                        annotationTarget: target,
                        interposingQueue: []
                    });
                });
            }
        });
    }

    for (const [fileName, content, testCases] of badSamples) {
        describe(`Negative tests for #${fileName}`, () => {
            let units: SourceUnit[];

            before(() => {
                const result = toAst(fileName, content);

                units = result.units;
            });

            for (const [specString, loc] of testCases) {
                it(`SemCheck for ${specString} throws as expected`, () => {
                    const compilerVersion = "0.6.0";
                    const encoderVer = getABIEncoderVersion(units, compilerVersion);
                    const target = getTarget(loc, units);
                    const annotation = parseAnnotation(specString, target, compilerVersion);
                    const [ctx] = getTypeCtxAndTarget(loc, units, compilerVersion, annotation);
                    const typeEnv = new TypeEnv(compilerVersion, encoderVer);
                    tcAnnotation(annotation, ctx, target, typeEnv);
                    expect(
                        scAnnotation.bind(scAnnotation, annotation, typeEnv, new Map(), {
                            isOld: false,
                            annotation,
                            interposingQueue: [],
                            annotationTarget: target
                        })
                    ).toThrowError(SemError as any);
                });
            }
        });
    }
});
