import expect from "expect";
import { pp, single } from "../../src/util";
import { toAst } from "../integration/utils";
import { findAliasedStateVars, getAssignments, LHS, RHS } from "../../src/instrumenter";
import { Logger } from "../../src/logger";
import { ASTNode, ASTWriter, DefaultASTWriterMapping, PrettyFormatter } from "solc-typed-ast";

export type LocationDesc = [string, string];

const writer = new ASTWriter(DefaultASTWriterMapping, new PrettyFormatter(4), "0.8.0");

function print(n: ASTNode | RHS | LHS): string {
    if (n instanceof ASTNode) {
        return writer.write(n);
    }

    if (typeof n[1] === "string") {
        return `<${print(n[0])}.${n[1]}>`;
    } else {
        return `<${print(n[0])}[${n[1]}]>`;
    }
}

describe("Finding all assignments.", () => {
    const samples: Array<[string, string, Set<string>]> = [
        [
            "foo.sol",
            `
            pragma solidity 0.8.0;
            address constant cosntT = address(0);

            contract Base {
                uint y = 1;
                constructor(uint x) {
                    y = x;
                }
            }

            contract T1 is Base(1) {
                function takeAndRet(uint a, uint b) public returns (uint z) {
                    return a+b;
                }

                function takeAndRetUnnamed(uint a, uint b) public returns (uint) {
                    return a+b;
                }

                uint[] arr;

                modifier P(uint[] storage t) {
                    t.push(1);
                    _;
                }

                function foo() public returns (uint, uint, uint) {
                    return (1, 2, 3);
                }

                function main() P(arr) public {
                    uint z = takeAndRet(arr[0], arr[1]);

                    (uint x, ,uint y) = (z, 1, 4);
                    (uint i, uint j, uint k) = foo();
                    (, uint j1, ) = foo();
                }
            }`,
            new Set([
                "address(0) -> address constant cosntT = address(0)",
                "1 -> uint internal y = 1",
                "x -> y",
                "1 -> uint x",
                "a + b -> uint z",
                "a + b -> uint",
                "arr -> uint[] storage t",
                "arr[0] -> uint a",
                "arr[1] -> uint b",
                "takeAndRet(arr[0], arr[1]) -> uint z",
                "z -> uint x",
                "4 -> uint y",
                "1 -> uint",
                "2 -> uint",
                "3 -> uint",
                "<foo()[0]> -> uint i",
                "<foo()[1]> -> uint j",
                "<foo()[2]> -> uint k",
                "<foo()[1]> -> uint j1"
            ])
        ]
    ];

    for (const [fileName, content, expectedAssignmentDescs] of samples) {
        it(`Sample #${fileName}`, () => {
            const [sources] = toAst(fileName, content);
            const unit = single(sources);

            const assignments = getAssignments(unit);
            const assignmentDescs = new Set(
                [...assignments].map(([lhs, rhs]) => `${print(rhs)} -> ${print(lhs)}`)
            );
            Logger.debug(
                `Expected aliased set ${pp(expectedAssignmentDescs)} got ${pp([
                    ...assignmentDescs
                ])}`
            );
            expect(assignmentDescs).toEqual(expectedAssignmentDescs);
        });
    }
});

describe("Finding aliased vars.", () => {
    const samples: Array<[string, string, Set<string>]> = [
        [
            "foo.sol",
            `
            contract T1 {
                  struct S {
                    uint t;
                }
                
                enum E { A, B, C }
                
                uint aliasableUint;
                address aliasableAddress;
                E aliasableEnum;
                uint[] aliasableArr;
                uint[] unaliasedArr;

                mapping(uint => uint) aliasableMap1;
                mapping(uint => uint[]) aliasableMap2;
                S alisableStruct;
                string alisableStr;
                bytes alisableBytes;
                
                function aliasable() public {
                    //uint storage p1 = aliasableUint;    
                    //address storage p2 = aliasableArr;
                    //E storage p7 = aliasableEnum;
                    uint[] storage p3 = aliasableArr;
                    mapping(uint => uint) storage p4 = aliasableMap1;
                    mapping(uint => uint[]) storage p5 = aliasableMap2;
                    S storage p6 = alisableStruct;
                    string storage p8 = alisableStr;
                    bytes storage p9 = alisableBytes;

                    uint t = unaliasedArr[1];
                    uint[] memory p10 = unaliasedArr;

                    unaliasedArr[1] = 10;
                    unaliasedArr = p10;
                }  
            }`,
            new Set([
                "aliasableArr",
                "aliasableMap1",
                "aliasableMap2",
                "alisableStruct",
                "alisableStr",
                "alisableBytes"
            ])
        ],
        [
            "foo.sol",
            `
            contract Base {
                uint[] y1;
            }

            contract IfUpdated is Base {
                // Can't leak primitive types
                uint v;
                address a;
                // leaked
                string public s = "abcd";
                // not leaked
                string public s1 = "abcd";

                // Leaks
                uint[] x1;
                uint[] x2;
                uint[] x3;
                uint[] x4;
                uint[] x5;
                uint[] x6;
                uint[] x7;
                uint[] x8;
                uint[] x9;
                uint[] x10;
                
                modifier M(uint[] storage p) {
                    p.push(1);
                    _;
                }
                
                function dummy(uint[] storage z) internal {
                    z.pop();
                }

                function ret1() internal returns (uint[] storage t) {
                    t = x5;
                }

                function ret2() internal returns (uint[] storage t) {
                    return x6;
                }

                function ret3() internal returns (uint[] storage, address, uint[] storage) {
                    return (x7, address(0), x8);
                }

                function passthourghRet3() internal returns  (uint[] storage, address, uint[] storage) {
                    return ret3();
                }

                function ret4() internal returns (uint[] memory) {
                    return x9;
                }

                function ret5() internal returns (uint) {
                    return x10[1];
                }
                
                function leaks() M(x1) public {
                    uint[] storage y = x2;
                    (uint a, , uint[] storage c,) = (1, 4, x3, 5);
                    dummy(x4);

                    bytes storage bts = bytes(s);
                    bts[0] = 0x7a;
                    bytes memory bts1 = bytes(s1);
                    bts1[0] = 0x7a;
                    
                    uint[] storage w = Base.y1;

                    ret1();
                    ret2();
                }
            }
            `,

            new Set(["s", "x1", "x2", "x3", "x4", "x5", "x6", "x7", "x8", "y1"])
        ]
    ];

    for (const [fileName, content, expectedAliasedNames] of samples) {
        it(`Sample #${fileName}`, () => {
            const [sources] = toAst(fileName, content);
            const unit = single(sources);

            const aliased = findAliasedStateVars([unit]);
            const aliasedNames = new Set([...aliased].map((decl) => decl.name));
            Logger.debug(
                `Expected aliased set ${pp(expectedAliasedNames)} got ${pp(aliasedNames)}`
            );
            expect(aliasedNames).toEqual(expectedAliasedNames);
        });
    }
});
