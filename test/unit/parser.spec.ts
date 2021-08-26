import bigInt from "big-integer";
import expect from "expect";
import { ASTNode, BoolType, IntType } from "solc-typed-ast";
import { Logger } from "../../src/logger";
import {
    AnnotationType,
    SAnnotation,
    SBinaryOperation,
    SBooleanLiteral,
    SConditional,
    SForAll,
    SFunctionCall,
    SId,
    SIfAssigned,
    SIfUpdated,
    SIndexAccess,
    SLet,
    SMemberAccess,
    SNode,
    SNumber,
    SProperty,
    SResult,
    SUnaryOperation,
    SUserFunctionDefinition
} from "../../src/spec-lang/ast";
import { parseAnnotation, parseExpression as parseExpr } from "../../src/spec-lang/expr_parser";
import { eq } from "../../src/util/struct_equality";

describe("Expression Parser Unit Tests", () => {
    const goodSamples: Array<[string, SNode]> = [
        // Literals
        ["abcd", new SId("abcd")],
        ["1234", new SNumber(bigInt(1234), 10)],
        ["10 wei", new SNumber(bigInt(10), 10)],
        ["10 gwei", new SNumber(bigInt(1e10), 10)],

        ["1 ether", new SNumber(bigInt(1e18), 10)],
        ["100 seconds", new SNumber(bigInt(100), 10)],
        ["100 \n\n\n minutes", new SNumber(bigInt(6000), 10)],
        ["100 hours", new SNumber(bigInt(360000), 10)],
        ["100 days", new SNumber(bigInt(8640000), 10)],
        ["100 weeks", new SNumber(bigInt(60480000), 10)],
        ["true", new SBooleanLiteral(true)],
        ["false", new SBooleanLiteral(false)],
        // ops
        ["-1", new SUnaryOperation("-", new SNumber(bigInt(1), 10))],
        ["--a", new SUnaryOperation("-", new SUnaryOperation("-", new SId("a")))],
        ["!-a", new SUnaryOperation("!", new SUnaryOperation("-", new SId("a")))],
        // Binary ops
        // Power
        [
            "43**0x9",
            new SBinaryOperation(new SNumber(bigInt(43), 10), "**", new SNumber(bigInt(9), 16))
        ],
        [
            "2**2**3",
            new SBinaryOperation(
                new SBinaryOperation(new SNumber(bigInt(2), 10), "**", new SNumber(bigInt(2), 10)),
                "**",
                new SNumber(bigInt(3), 10)
            )
        ],
        // Multiplicative
        [
            "43*0x9",
            new SBinaryOperation(new SNumber(bigInt(43), 10), "*", new SNumber(bigInt(9), 16))
        ],
        [
            "43*0x9*a",
            new SBinaryOperation(
                new SBinaryOperation(new SNumber(bigInt(43), 10), "*", new SNumber(bigInt(9), 16)),
                "*",
                new SId("a")
            )
        ],
        [
            "43*0x9/a",
            new SBinaryOperation(
                new SBinaryOperation(new SNumber(bigInt(43), 10), "*", new SNumber(bigInt(9), 16)),
                "/",
                new SId("a")
            )
        ],
        [
            "43%0x9/a",
            new SBinaryOperation(
                new SBinaryOperation(new SNumber(bigInt(43), 10), "%", new SNumber(bigInt(9), 16)),
                "/",
                new SId("a")
            )
        ],
        // Here left-to-right order matters for correctness. With the correct order this evals to 3, and with the wrong one to 1
        [
            "13%7/2",
            new SBinaryOperation(
                new SBinaryOperation(new SNumber(bigInt(13), 10), "%", new SNumber(bigInt(7), 10)),
                "/",
                new SNumber(bigInt(2), 10)
            )
        ],
        // Additive
        [
            "43+0x9",
            new SBinaryOperation(new SNumber(bigInt(43), 10), "+", new SNumber(bigInt(9), 16))
        ],
        [
            "43-5",
            new SBinaryOperation(new SNumber(bigInt(43), 10), "-", new SNumber(bigInt(5), 10))
        ],
        [
            "43-5*6",
            new SBinaryOperation(
                new SNumber(bigInt(43), 10),
                "-",
                new SBinaryOperation(new SNumber(bigInt(5), 10), "*", new SNumber(bigInt(6), 10))
            )
        ],
        //assert(43-5*-6==73);
        [
            "43-5*-6",
            new SBinaryOperation(
                new SNumber(bigInt(43), 10),
                "-",
                new SBinaryOperation(
                    new SNumber(bigInt(5), 10),
                    "*",
                    new SUnaryOperation("-", new SNumber(bigInt(6), 10))
                )
            )
        ],
        //assert(43-5+6==44);
        [
            "43-5+6",
            new SBinaryOperation(
                new SBinaryOperation(new SNumber(bigInt(43), 10), "-", new SNumber(bigInt(5), 10)),
                "+",
                new SNumber(bigInt(6), 10)
            )
        ],
        // Bitwise
        //assert(256 >> 4 == 16);
        [
            "256>>4",
            new SBinaryOperation(new SNumber(bigInt(256), 10), ">>", new SNumber(bigInt(4), 10))
        ],
        //assert(256 >> 4 >> 1 == 8);
        [
            "256>>4>>1",
            new SBinaryOperation(
                new SBinaryOperation(
                    new SNumber(bigInt(256), 10),
                    ">>",
                    new SNumber(bigInt(4), 10)
                ),
                ">>",
                new SNumber(bigInt(1), 10)
            )
        ],
        // assert(256 << 4 << 1 == 2 ** 13);
        [
            "256<<4<<1",
            new SBinaryOperation(
                new SBinaryOperation(
                    new SNumber(bigInt(256), 10),
                    "<<",
                    new SNumber(bigInt(4), 10)
                ),
                "<<",
                new SNumber(bigInt(1), 10)
            )
        ],
        // assert(3+4 << 1 == 14);
        // weird right?
        [
            "3+4<<1",
            new SBinaryOperation(
                new SBinaryOperation(new SNumber(bigInt(3), 10), "+", new SNumber(bigInt(4), 10)),
                "<<",
                new SNumber(bigInt(1), 10)
            )
        ],
        // assert(3+2*2 << 1 == 14);
        [
            "3+2*2<<1",
            new SBinaryOperation(
                new SBinaryOperation(
                    new SNumber(bigInt(3), 10),
                    "+",
                    new SBinaryOperation(
                        new SNumber(bigInt(2), 10),
                        "*",
                        new SNumber(bigInt(2), 10)
                    )
                ),
                "<<",
                new SNumber(bigInt(1), 10)
            )
        ],
        // assert(3*3 << 1 == 18);
        [
            "3*3<<1",
            new SBinaryOperation(
                new SBinaryOperation(new SNumber(bigInt(3), 10), "*", new SNumber(bigInt(3), 10)),
                "<<",
                new SNumber(bigInt(1), 10)
            )
        ],
        // relational operators
        ["4>0", new SBinaryOperation(new SNumber(bigInt(4), 10), ">", new SNumber(bigInt(0), 10))],
        [
            "4+4<=8",
            new SBinaryOperation(
                new SBinaryOperation(new SNumber(bigInt(4), 10), "+", new SNumber(bigInt(4), 10)),
                "<=",
                new SNumber(bigInt(8), 10)
            )
        ],
        [
            "-1*5>=-6",
            new SBinaryOperation(
                new SBinaryOperation(
                    new SUnaryOperation("-", new SNumber(bigInt(1), 10)),
                    "*",
                    new SNumber(bigInt(5), 10)
                ),
                ">=",
                new SUnaryOperation("-", new SNumber(bigInt(6), 10))
            )
        ],
        [
            "3<<2>=6",
            new SBinaryOperation(
                new SBinaryOperation(new SNumber(bigInt(3), 10), "<<", new SNumber(bigInt(2), 10)),
                ">=",
                new SNumber(bigInt(6), 10)
            )
        ],
        // Equality operators
        [
            "4 == 4",
            new SBinaryOperation(new SNumber(bigInt(4), 10), "==", new SNumber(bigInt(4), 10))
        ],
        [
            "3+1 == 2+2",
            new SBinaryOperation(
                new SBinaryOperation(new SNumber(bigInt(3), 10), "+", new SNumber(bigInt(1), 10)),
                "==",
                new SBinaryOperation(new SNumber(bigInt(2), 10), "+", new SNumber(bigInt(2), 10))
            )
        ],
        [
            "3>1 == 2>=2",
            new SBinaryOperation(
                new SBinaryOperation(new SNumber(bigInt(3), 10), ">", new SNumber(bigInt(1), 10)),
                "==",
                new SBinaryOperation(new SNumber(bigInt(2), 10), ">=", new SNumber(bigInt(2), 10))
            )
        ],
        [
            "true == false == false",
            new SBinaryOperation(
                new SBinaryOperation(new SBooleanLiteral(true), "==", new SBooleanLiteral(false)),
                "==",
                new SBooleanLiteral(false)
            )
        ],
        // Bitwise binary operators
        [
            "3 & 4",
            new SBinaryOperation(new SNumber(bigInt(3), 10), "&", new SNumber(bigInt(4), 10))
        ],
        [
            "3 | 4",
            new SBinaryOperation(new SNumber(bigInt(3), 10), "|", new SNumber(bigInt(4), 10))
        ],
        [
            "3 ^ 4",
            new SBinaryOperation(new SNumber(bigInt(3), 10), "^", new SNumber(bigInt(4), 10))
        ],
        [
            "3 + 4 ^ 4",
            new SBinaryOperation(
                new SBinaryOperation(new SNumber(bigInt(3), 10), "+", new SNumber(bigInt(4), 10)),
                "^",
                new SNumber(bigInt(4), 10)
            )
        ],
        [
            "3 ^ 4 & 4",
            new SBinaryOperation(
                new SNumber(bigInt(3), 10),
                "^",
                new SBinaryOperation(new SNumber(bigInt(4), 10), "&", new SNumber(bigInt(4), 10))
            )
        ],
        [
            "3 | 4 ^ 4",
            new SBinaryOperation(
                new SNumber(bigInt(3), 10),
                "|",
                new SBinaryOperation(new SNumber(bigInt(4), 10), "^", new SNumber(bigInt(4), 10))
            )
        ],
        [
            "true || false",
            new SBinaryOperation(new SBooleanLiteral(true), "||", new SBooleanLiteral(false))
        ],
        [
            "true && true",
            new SBinaryOperation(new SBooleanLiteral(true), "&&", new SBooleanLiteral(true))
        ],
        [
            "3<4 && 3^4 > 3",
            new SBinaryOperation(
                new SBinaryOperation(new SNumber(bigInt(3), 10), "<", new SNumber(bigInt(4), 10)),
                "&&",
                new SBinaryOperation(
                    new SBinaryOperation(
                        new SNumber(bigInt(3), 10),
                        "^",
                        new SNumber(bigInt(4), 10)
                    ),
                    ">",
                    new SNumber(bigInt(3), 10)
                )
            )
        ],
        [
            "false ==> true",
            new SBinaryOperation(new SBooleanLiteral(false), "==>", new SBooleanLiteral(true))
        ],
        [
            "3+4>1 ==> true",
            new SBinaryOperation(
                new SBinaryOperation(
                    new SBinaryOperation(
                        new SNumber(bigInt(3), 10),
                        "+",
                        new SNumber(bigInt(4), 10)
                    ),
                    ">",
                    new SNumber(bigInt(1), 10)
                ),
                "==>",
                new SBooleanLiteral(true)
            )
        ],
        // We define implication to be right-associative.
        [
            "3+4>1 ==> true ==> 1==1",
            new SBinaryOperation(
                new SBinaryOperation(
                    new SBinaryOperation(
                        new SNumber(bigInt(3), 10),
                        "+",
                        new SNumber(bigInt(4), 10)
                    ),
                    ">",
                    new SNumber(bigInt(1), 10)
                ),
                "==>",
                new SBinaryOperation(
                    new SBooleanLiteral(true),
                    "==>",
                    new SBinaryOperation(
                        new SNumber(bigInt(1), 10),
                        "==",
                        new SNumber(bigInt(1), 10)
                    )
                )
            )
        ],
        // Member Expressions
        ["a.b", new SMemberAccess(new SId("a"), "b")],
        ["a.b.c", new SMemberAccess(new SMemberAccess(new SId("a"), "b"), "c")],
        [
            "1<a.b.c",
            new SBinaryOperation(
                new SNumber(bigInt(1), 10),
                "<",
                new SMemberAccess(new SMemberAccess(new SId("a"), "b"), "c")
            )
        ],
        // Index Expressions
        ["a[b]", new SIndexAccess(new SId("a"), new SId("b"))],
        [
            "a[b+c]",
            new SIndexAccess(new SId("a"), new SBinaryOperation(new SId("b"), "+", new SId("c")))
        ],
        [
            "a[b+c][d]",
            new SIndexAccess(
                new SIndexAccess(
                    new SId("a"),
                    new SBinaryOperation(new SId("b"), "+", new SId("c"))
                ),
                new SId("d")
            )
        ],
        [
            "a[d][b+c]",
            new SIndexAccess(
                new SIndexAccess(new SId("a"), new SId("d")),
                new SBinaryOperation(new SId("b"), "+", new SId("c"))
            )
        ],
        ["a.foo[b]", new SIndexAccess(new SMemberAccess(new SId("a"), "foo"), new SId("b"))],
        [
            "a[d].foo[b+c]",
            new SIndexAccess(
                new SMemberAccess(new SIndexAccess(new SId("a"), new SId("d")), "foo"),
                new SBinaryOperation(new SId("b"), "+", new SId("c"))
            )
        ],
        // Function calls
        ["a()", new SFunctionCall(new SId("a"), [])],
        ["a(1)", new SFunctionCall(new SId("a"), [new SNumber(bigInt(1), 10)])],
        [
            "a(1, 0x2+c)",
            new SFunctionCall(new SId("a"), [
                new SNumber(bigInt(1), 10),
                new SBinaryOperation(new SNumber(bigInt(2), 16), "+", new SId("c"))
            ])
        ],
        [
            "a(1, 0x2+c, x.f)",
            new SFunctionCall(new SId("a"), [
                new SNumber(bigInt(1), 10),
                new SBinaryOperation(new SNumber(bigInt(2), 16), "+", new SId("c")),
                new SMemberAccess(new SId("x"), "f")
            ])
        ],
        [
            "a.f(1)",
            new SFunctionCall(new SMemberAccess(new SId("a"), "f"), [new SNumber(bigInt(1), 10)])
        ],
        [
            "a.f[b](1)",
            new SFunctionCall(
                new SIndexAccess(new SMemberAccess(new SId("a"), "f"), new SId("b")),
                [new SNumber(bigInt(1), 10)]
            )
        ],
        [
            "a().f[b](1)",
            new SFunctionCall(
                new SIndexAccess(
                    new SMemberAccess(new SFunctionCall(new SId("a"), []), "f"),
                    new SId("b")
                ),
                [new SNumber(bigInt(1), 10)]
            )
        ],
        // Old expression (looks like a function call but is treated as a unary operation)
        ["old(a)", new SUnaryOperation("old", new SId("a"))],
        ["old(a).f", new SMemberAccess(new SUnaryOperation("old", new SId("a")), "f")],
        ["old(a)[f]", new SIndexAccess(new SUnaryOperation("old", new SId("a")), new SId("f"))],
        [
            "old(a+b)",
            new SUnaryOperation("old", new SBinaryOperation(new SId("a"), "+", new SId("b")))
        ],
        ["old(a)()", new SFunctionCall(new SUnaryOperation("old", new SId("a")), [])],
        // Conditional
        ["a?b:c", new SConditional(new SId("a"), new SId("b"), new SId("c"))],
        [
            "a?b+1:c-d",
            new SConditional(
                new SId("a"),
                new SBinaryOperation(new SId("b"), "+", new SNumber(bigInt(1), 10)),
                new SBinaryOperation(new SId("c"), "-", new SId("d"))
            )
        ],
        [
            "false || true ? false : true",
            new SConditional(
                new SBinaryOperation(new SBooleanLiteral(false), "||", new SBooleanLiteral(true)),
                new SBooleanLiteral(false),
                new SBooleanLiteral(true)
            )
        ],
        [
            "false || true ? 1 : 2",
            new SConditional(
                new SBinaryOperation(new SBooleanLiteral(false), "||", new SBooleanLiteral(true)),
                new SNumber(bigInt(1), 10),
                new SNumber(bigInt(2), 10)
            )
        ],
        [
            // ternaries have a  higher priority than || (this evaluates to true)
            "true ? true : false || false",
            new SConditional(
                new SBooleanLiteral(true),
                new SBooleanLiteral(true),
                new SBinaryOperation(new SBooleanLiteral(false), "||", new SBooleanLiteral(false))
            )
        ],
        [
            // ternaries associate to the right (this evaluates to true)
            "true ? true : false ? false : true",
            new SConditional(
                new SBooleanLiteral(true),
                new SBooleanLiteral(true),
                new SConditional(
                    new SBooleanLiteral(false),
                    new SBooleanLiteral(false),
                    new SBooleanLiteral(true)
                )
            )
        ],
        // Let expressions
        ["let a := 1 in a", new SLet([new SId("a")], new SNumber(bigInt(1), 10), new SId("a"))],
        [
            "let a := b+c in a",
            new SLet(
                [new SId("a")],
                new SBinaryOperation(new SId("b"), "+", new SId("c")),
                new SId("a")
            )
        ],
        [
            "let a := b+c in a*a",
            new SLet(
                [new SId("a")],
                new SBinaryOperation(new SId("b"), "+", new SId("c")),
                new SBinaryOperation(new SId("a"), "*", new SId("a"))
            )
        ],
        [
            "let a := let b := 1 in b+b in a*a",
            new SLet(
                [new SId("a")],
                new SLet(
                    [new SId("b")],
                    new SNumber(bigInt(1), 10),
                    new SBinaryOperation(new SId("b"), "+", new SId("b"))
                ),
                new SBinaryOperation(new SId("a"), "*", new SId("a"))
            )
        ],
        [
            "let a := let b := 1 in b+b in let c := a*a in c+1",
            new SLet(
                [new SId("a")],
                new SLet(
                    [new SId("b")],
                    new SNumber(bigInt(1), 10),
                    new SBinaryOperation(new SId("b"), "+", new SId("b"))
                ),
                new SLet(
                    [new SId("c")],
                    new SBinaryOperation(new SId("a"), "*", new SId("a")),
                    new SBinaryOperation(new SId("c"), "+", new SNumber(bigInt(1), 10))
                )
            )
        ],
        [
            "let a, b := foo() in a+b",
            new SLet(
                [new SId("a"), new SId("b")],
                new SFunctionCall(new SId("foo"), []),
                new SBinaryOperation(new SId("a"), "+", new SId("b"))
            )
        ],
        [
            "forall (uint x in a) a[x]>10",
            new SForAll(
                new IntType(256, false),
                new SId("x"),
                new SBinaryOperation(
                    new SIndexAccess(new SId("a"), new SId("x")),
                    ">",
                    new SNumber(bigInt(10), 10)
                ),
                undefined,
                undefined,
                new SId("a")
            )
        ],
        [
            "forall (uint x in 1...10) a[x]>10",
            new SForAll(
                new IntType(256, false),
                new SId("x"),
                new SBinaryOperation(
                    new SIndexAccess(new SId("a"), new SId("x")),
                    ">",
                    new SNumber(bigInt(10), 10)
                ),
                new SNumber(bigInt(1), 10),
                new SNumber(bigInt(10), 10)
            )
        ],
        ["$result", new SResult()]
    ];

    const badSamples: string[] = [
        "0asdf",
        "100 satoshi",
        "0x10ab gwei",
        "0x123av",
        "123a",
        "a.1",
        "old",
        "old.foo",
        "old+1",
        "old[1]",
        "old(1,2)",
        "forall (uint x in let) f(sheep)",
        "forall (uint x in [0, 100)] a[x] > 10",
        "forall (x in 0...100) x > 0"
    ];

    for (const [sample, expectedAST] of goodSamples) {
        describe(`Sample ${sample}`, () => {
            it("Parses correctly", () => {
                const parsed = parseExpr(sample, undefined as unknown as ASTNode, "0.6.0");
                expect(eq(parsed, expectedAST)).toEqual(true);
            });
        });
    }

    for (const sample of badSamples) {
        describe(`Sample ${sample}`, () => {
            it("Fails as expected", () => {
                expect(parseExpr.bind(parseExpr, sample)).toThrow();
            });
        });
    }
});

describe("Annotation Parser Unit Tests", () => {
    const goodSamples: Array<[string, SAnnotation]> = [
        ["if_succeeds true;", new SProperty(AnnotationType.IfSucceeds, new SBooleanLiteral(true))],
        [
            "/// if_succeeds true;",
            new SProperty(AnnotationType.IfSucceeds, new SBooleanLiteral(true))
        ],

        [
            '/// if_succeeds {:msg "hi"} true;',
            new SProperty(AnnotationType.IfSucceeds, new SBooleanLiteral(true), "hi")
        ],
        [
            `* if_succeeds 
                {:msg 
                       "hi"
                    }
                     1 -
                     2
                     ;`,
            new SProperty(
                AnnotationType.IfSucceeds,
                new SBinaryOperation(new SNumber(bigInt(1), 10), "-", new SNumber(bigInt(2), 10)),
                "hi"
            )
        ],
        [
            `* if_updated 
                {:msg 
                       "hi"
                    }
                     1 -
                     2
                     ;`,
            new SIfUpdated(
                new SBinaryOperation(new SNumber(bigInt(1), 10), "-", new SNumber(bigInt(2), 10)),
                [],
                "hi"
            )
        ],
        [
            `* if_assigned[a]
                {:msg 
                       "bye"
                    }
                    true;
                     ;`,
            new SIfAssigned(new SBooleanLiteral(true), [new SId("a")], "bye")
        ],
        [
            `* if_assigned.foo
                {:msg 
                       "bye"
                    }
                    true;
                     ;`,
            new SIfAssigned(new SBooleanLiteral(true), ["foo"], "bye")
        ],
        [
            `* if_assigned._bar0.boo[a][b].foo[c]
                {:msg 
                       "felicia"
                    }
                    false;
                     ;`,
            new SIfAssigned(
                new SBooleanLiteral(false),
                ["_bar0", "boo", new SId("a"), new SId("b"), "foo", new SId("c")],
                "felicia"
            )
        ],
        [
            `* invariant 
                {:msg 
                       "hi"
                    }
                     1 -
                     2
                     ;`,
            new SProperty(
                AnnotationType.Invariant,
                new SBinaryOperation(new SNumber(bigInt(1), 10), "-", new SNumber(bigInt(2), 10)),
                "hi"
            )
        ],
        [
            "define foo() bool = true;",
            new SUserFunctionDefinition(
                new SId("foo"),
                [],
                new BoolType(),
                new SBooleanLiteral(true)
            )
        ],
        [
            "/// define foo() bool = true;",
            new SUserFunctionDefinition(
                new SId("foo"),
                [],
                new BoolType(),
                new SBooleanLiteral(true)
            )
        ],
        [
            "* define foo() bool = true;",
            new SUserFunctionDefinition(
                new SId("foo"),
                [],
                new BoolType(),
                new SBooleanLiteral(true)
            )
        ],
        [
            'define {:msg "tralala" } foo() bool = true;',
            new SUserFunctionDefinition(
                new SId("foo"),
                [],
                new BoolType(),
                new SBooleanLiteral(true),
                "tralala"
            )
        ],
        [
            `define 
                {:msg
                        "tralala"
                         }
                             foo(

                             )
                              bool
                               = 
                               true
;`,
            new SUserFunctionDefinition(
                new SId("foo"),
                [],
                new BoolType(),
                new SBooleanLiteral(true),
                "tralala"
            )
        ],
        [
            "define boo(uint a) uint = a;",
            new SUserFunctionDefinition(
                new SId("boo"),
                [[new SId("a"), new IntType(256, false)]],
                new IntType(256, false),
                new SId("a")
            )
        ],
        [
            "define moo(uint a, uint b) uint = a+b;",
            new SUserFunctionDefinition(
                new SId("moo"),
                [
                    [new SId("a"), new IntType(256, false)],
                    [new SId("b"), new IntType(256, false)]
                ],
                new IntType(256, false),
                new SBinaryOperation(new SId("a"), "+", new SId("b"))
            )
        ],
        [
            "/// if_succeeds forall (uint x in 1...10) a[x]>10;",
            new SProperty(
                AnnotationType.IfSucceeds,
                new SForAll(
                    new IntType(256, false),
                    new SId("x"),
                    new SBinaryOperation(
                        new SIndexAccess(new SId("a"), new SId("x")),
                        ">",
                        new SNumber(bigInt(10), 10)
                    ),
                    new SNumber(bigInt(1), 10),
                    new SNumber(bigInt(10), 10)
                )
            )
        ],
        [
            "/// if_succeeds forall (uint x in a) a[x]>10;",
            new SProperty(
                AnnotationType.IfSucceeds,
                new SForAll(
                    new IntType(256, false),
                    new SId("x"),
                    new SBinaryOperation(
                        new SIndexAccess(new SId("a"), new SId("x")),
                        ">",
                        new SNumber(bigInt(10), 10)
                    ),
                    undefined,
                    undefined,
                    new SId("a")
                )
            )
        ],
        ["/// assert true;", new SProperty(AnnotationType.Assert, new SBooleanLiteral(true))],
        [
            "/// assert forall (uint x in a) a[x] > 10;",
            new SProperty(
                AnnotationType.Assert,
                new SForAll(
                    new IntType(256, false),
                    new SId("x"),
                    new SBinaryOperation(
                        new SIndexAccess(new SId("a"), new SId("x")),
                        ">",
                        new SNumber(bigInt(10), 10)
                    ),
                    undefined,
                    undefined,
                    new SId("a")
                )
            )
        ]
    ];

    const badSamples: string[] = [
        `* if_assigned[1+2]
                {:msg 
                       "felicia"
                    }
                    false;
                     ;`,
        `* if_assigned [a]
                {:msg 
                       "felicia"
                    }
                    false;
                     ;`,
        `* if_assigned0ab
                {:msg 
                       "felicia"
                    }
                    false;
                     ;`,
        `* if_assigned,ab
                {:msg 
                       "felicia"
                    }
                    false;
                     ;`,
        `* if_updated[a]
                {:msg 
                       "bye"
                    }
                    true;
                     ;`,
        `* if_updated.foo
                {:msg 
                       "bye"
                    }
                    true;
                     ;`
    ];

    for (const [sample, expected] of goodSamples) {
        describe(`Sample ${sample}`, () => {
            it("Parses correctly", () => {
                const parsed = parseAnnotation(sample, undefined as unknown as ASTNode, "0.6.0");
                Logger.debug(`[${sample}]: Got: ${parsed.pp()} expected: ${expected.pp()}`);
                expect(eq(parsed, expected)).toEqual(true);
            });
        });
    }

    for (const sample of badSamples) {
        describe(`Sample ${sample}`, () => {
            it("Fails as expected", () => {
                expect(parseAnnotation.bind(parseAnnotation, sample)).toThrow();
            });
        });
    }
});
