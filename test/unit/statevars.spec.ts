import expect from "expect";
import { pp, single } from "../../src/util";
import { toAst } from "../integration/utils";
import {
    findAliasedStateVars,
    getAssignments,
    LHS,
    RHS,
    findStateVarUpdates,
    StateVarUpdateDesc
} from "../../src/instrumenter";
import { Logger } from "../../src/logger";
import { ASTNode, Expression } from "solc-typed-ast";
import { print as printNode } from "../../src/util";

export type LocationDesc = [string, string];

function print(n: ASTNode | RHS | LHS): string {
    if (n instanceof ASTNode) {
        return printNode(n);
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
                uint[] x11;
                uint[] x12;
                uint[] x13;
                
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

                    y = v > 0 ? x11 : x12;

                    y = (x13);
                }
            }
            `,

            new Set([
                "s",
                "x1",
                "x2",
                "x3",
                "x4",
                "x5",
                "x6",
                "x7",
                "x8",
                "y1",
                "x11",
                "x12",
                "x13"
            ])
        ],
        [
            "library.sol",
            `
            library ArrLib {
                function push2(uint[] storage arr, uint x, uint y) internal {
                    arr.push(x);
                    arr.push(y);
                }
            }

            contract LibTest {
                using ArrLib for *;

                uint[] arr;
                function leaks() public {
                    arr.push2(1,2);
                }
            }
            `,

            new Set(["arr"])
        ]
    ];

    for (const [fileName, content, expectedAliasedNames] of samples) {
        it(`Sample #${fileName}`, () => {
            const [sources] = toAst(fileName, content);
            const unit = single(sources);

            const aliased = findAliasedStateVars([unit]);
            const aliasedNames = new Set([...aliased.keys()].map((decl) => decl.name));
            Logger.debug(
                `Expected aliased set ${pp(expectedAliasedNames)} got ${pp(aliasedNames)}`
            );
            expect(aliasedNames).toEqual(expectedAliasedNames);
        });
    }
});

function printStateVarUpdateDesc(desc: StateVarUpdateDesc): string {
    const [node, decl, path, newVal] = desc;
    let nodeStr = print(node instanceof Array ? node[0] : node);
    if (node instanceof Array && node[1].length > 0) {
        nodeStr += `[${node[1].map((n) => `${n}`).join(", ")}]`;
    }

    const pathStr = path.map((v) => (v instanceof Expression ? print(v) : v)).join(", ");
    let newValStr: string;

    if (newVal instanceof Expression) {
        newValStr = print(newVal);
    } else if (newVal instanceof Array) {
        newValStr = `${print(newVal[0])}[${newVal[1]}]`;
    } else {
        newValStr = `undefined`;
    }

    return `${nodeStr}, ${decl.name}, [${pathStr}], ${newValStr}`;
}

describe("Finding all state variable updates.", () => {
    const samples: Array<[string, string, Set<string>]> = [
        [
            "primitve_and_arrays.sol",
            `
            pragma solidity 0.8.0;

            address constant cosntT = address(0);

            contract Base {
                uint y = 1;
                uint w = getOne();

                function getOne() pure internal returns (uint) {
                    return 1;
                }

                constructor(uint x) {
                    y = x;
                    y++;
                    y = --y;
                }
            }

            contract T1 is Base(1) {
                uint[] arr;
                modifier P(uint[] storage t) {
                    t.push(42);
                    _;
                }

                function getThree() public returns (uint, uint, uint) {
                    return (42,43,44);
                }

                function arrays() P(arr) public {
                    uint x;
                    uint y;
                    uint z;

                    arr.push(1);
                    assert(arr[0] == 42 && arr[1] == 1);

                    uint[] memory mArr = new uint[](3);
                    mArr[0] = 10; mArr[1] = 9; mArr[2] = 8;

                    arr = mArr;
                    assert(arr.length == 3 && arr[0] == 10 && arr[1] == 9 && arr[2] == 8);

                    arr[0] = 11;

                    x = 1;
                    y = 2;
                    z = 3;
                    (x, arr[0], (y, , arr[1], z)) = (arr[0], x, (arr[1], 1, z, arr[2]));
                    assert(arr.length == 3 && arr[0] == 1 && arr[1] == 3 && arr[2] == 8 && x == 11 && y == 9 && z == 8);

                    (T1.arr[0], T1.arr[1]) = (arr[1], arr[0]);
                    assert(arr[0] == 3 && arr[1] == 1);

                    (arr[0], arr[1], arr[2]) = getThree();
                    assert(arr[0] == 42 && arr[1] == 43 && arr[2] == 44);

                    arr = mArr;

                    (x, (arr[0], arr[1], arr[2]), y) = (1, getThree(), 2);
                    assert(arr[0] == 42 && arr[1] == 43 && arr[2] == 44);

                    arr.pop();
                    assert(arr.length == 2);

                    delete arr;

                    assert(arr.length == 0);
                }
            }
            `,
            new Set([
                "y = x, y, [], x",
                "arr.push(1), arr, [], undefined",
                "arr = mArr, arr, [], mArr",
                "arr[0] = 11, arr, [0], 11",
                "(x, arr[0], (y, , arr[1], z)) = (arr[0], x, (arr[1], 1, z, arr[2]))[1], arr, [0], x",
                "(x, arr[0], (y, , arr[1], z)) = (arr[0], x, (arr[1], 1, z, arr[2]))[2, 2], arr, [1], z",
                "(T1.arr[0], T1.arr[1]) = (arr[1], arr[0])[0], arr, [0], arr[1]",
                "(T1.arr[0], T1.arr[1]) = (arr[1], arr[0])[1], arr, [1], arr[0]",
                "arr.pop(), arr, [], undefined",
                "delete arr, arr, [], undefined",
                "(arr[0], arr[1], arr[2]) = getThree()[0], arr, [0], getThree()[0]",
                "(arr[0], arr[1], arr[2]) = getThree()[1], arr, [1], getThree()[1]",
                "(arr[0], arr[1], arr[2]) = getThree()[2], arr, [2], getThree()[2]",
                "(x, (arr[0], arr[1], arr[2]), y) = (1, getThree(), 2)[1, 0], arr, [0], getThree()[0]",
                "(x, (arr[0], arr[1], arr[2]), y) = (1, getThree(), 2)[1, 1], arr, [1], getThree()[1]",
                "(x, (arr[0], arr[1], arr[2]), y) = (1, getThree(), 2)[1, 2], arr, [2], getThree()[2]",
                "uint internal w = getOne(), w, [], getOne()",
                "uint internal y = 1, y, [], 1",
                "y++, y, [], undefined",
                "--y, y, [], undefined",
                "y = --y, y, [], --y"
            ])
        ],
        [
            "nested_arrays.sol",
            `
            pragma solidity 0.8.0;

            address constant cosntT = address(0);

            contract T1 {
                function getThree() public returns (uint, uint, uint) {
                    return (42,43,44);
                }

                uint[][] arr2 = [[1,2,3]];

                function nestedArrays() public {
                    uint x;
                    uint y;
                    uint z;

                    uint[] memory mArr = new uint[](3);
                    mArr[0] = 10; mArr[1] = 9; mArr[2] = 8;

                    arr2.push(mArr);
                    assert(arr2[0][0] == 1 && arr2[1][0] == 10);

                    uint[][] memory mArr2 = new uint[][](1);
                    mArr2[0] = mArr;

                    arr2 = mArr2;
                    assert(arr2.length == 1 && arr2[0][0] == 10 && arr2[0][1] == 9 && arr2[0][2] == 8);

                    arr2[0][0] = 11;

                    x = 1;
                    y = 2;
                    z = 3;
                    (x, arr2[0][0], (y, , arr2[0][1], z)) = (arr2[0][0], x, (arr2[0][1], 1, z, arr2[0][2]));
                    
                    assert(arr2.length == 1 && arr2[0].length == 3 && arr2[0][0] == 1 && arr2[0][1] == 3 && arr2[0][2] == 8 && x == 11 && y == 9 && z == 8);


                    arr2.push(mArr);
                    (T1.arr2[0], T1.arr2[1]) = (arr2[1], arr2[0]);
                    assert(arr2[0][0] == 1 && arr2[1][0] == 1);
                    
                    (arr2[0][0], arr2[0][1], arr2[0][2]) = getThree();
                    assert(arr2[0][0] == 42 && arr2[0][1] == 43 && arr2[0][2] == 44);

                    arr2 = mArr2;

                    (x, (arr2[0][0], arr2[0][1], arr2[0][2]), y) = (1, getThree(), 2);
                    assert(arr2[0][0] == 42 && arr2[0][1] == 43 && arr2[0][2] == 44);

                    arr2.pop();
                    
                    assert(arr2.length == 0);

                    arr2 = mArr2;
                    delete arr2;

                    assert(arr2.length == 0);
               
                }
            }
            `,
            new Set([
                "uint[][] internal arr2 = [[1, 2, 3]], arr2, [], [[1, 2, 3]]",
                "arr2.push(mArr), arr2, [], undefined",
                "arr2 = mArr2, arr2, [], mArr2",
                "arr2[0][0] = 11, arr2, [0, 0], 11",
                "(x, arr2[0][0], (y, , arr2[0][1], z)) = (arr2[0][0], x, (arr2[0][1], 1, z, arr2[0][2]))[1], arr2, [0, 0], x",
                "(x, arr2[0][0], (y, , arr2[0][1], z)) = (arr2[0][0], x, (arr2[0][1], 1, z, arr2[0][2]))[2, 2], arr2, [0, 1], z",
                "(T1.arr2[0], T1.arr2[1]) = (arr2[1], arr2[0])[0], arr2, [0], arr2[1]",
                "(T1.arr2[0], T1.arr2[1]) = (arr2[1], arr2[0])[1], arr2, [1], arr2[0]",
                "(arr2[0][0], arr2[0][1], arr2[0][2]) = getThree()[0], arr2, [0, 0], getThree()[0]",
                "(arr2[0][0], arr2[0][1], arr2[0][2]) = getThree()[1], arr2, [0, 1], getThree()[1]",
                "(arr2[0][0], arr2[0][1], arr2[0][2]) = getThree()[2], arr2, [0, 2], getThree()[2]",
                "(x, (arr2[0][0], arr2[0][1], arr2[0][2]), y) = (1, getThree(), 2)[1, 0], arr2, [0, 0], getThree()[0]",
                "(x, (arr2[0][0], arr2[0][1], arr2[0][2]), y) = (1, getThree(), 2)[1, 1], arr2, [0, 1], getThree()[1]",
                "(x, (arr2[0][0], arr2[0][1], arr2[0][2]), y) = (1, getThree(), 2)[1, 2], arr2, [0, 2], getThree()[2]",
                "arr2.pop(), arr2, [], undefined",
                "delete arr2, arr2, [], undefined"
            ])
        ],
        [
            "maps.sol",
            `
            pragma solidity 0.8.0;

            address constant cosntT = address(0);

            contract T1 {
                mapping (uint => uint) m;
                mapping (uint => uint) m1;
                function getThree() public returns (uint, uint, uint) {
                    return (42,43,44);
                }

                function maps() public {
                    uint x;
                    uint y;
                    uint z;

                    x = 1;
                    y = 2;
                    z = 3;
                    m[0] = 10;
                    m[1] =  9;
                    m[2] =  8;
                    assert(m[2] == 8);

                    (x, m[0], (y, ,m[1], z)) = (m[0], x, (m[1], 1, z, m[2]));
                    
                    assert(m[0] == 1 && m[1] == 3 && m[2] == 8 && x == 10 && y == 9 && z == 8);


                    (T1.m[0], T1.m[1]) = (m[1], m[0]);
                    assert(m[0] == 3 && m[1] == 1);
                    
                    (m[0], m[1], m[2]) = getThree();
                    assert(m[0] == 42 && m[1] == 43 && m[2] == 44);

                    //m = m1;

                    (x, (m[0], m[1], m[2]), y) = (1, getThree(), 2);
                    assert(m[0] == 42 && m[1] == 43 && m[2] == 44);

                    delete m[1];

                    assert(m[1] == 0);

                }
            }
            `,
            new Set([
                "m[0] = 10, m, [0], 10",
                "m[1] = 9, m, [1], 9",
                "m[2] = 8, m, [2], 8",
                "(x, m[0], (y, , m[1], z)) = (m[0], x, (m[1], 1, z, m[2]))[1], m, [0], x",
                "(x, m[0], (y, , m[1], z)) = (m[0], x, (m[1], 1, z, m[2]))[2, 2], m, [1], z",
                "(T1.m[0], T1.m[1]) = (m[1], m[0])[0], m, [0], m[1]",
                "(T1.m[0], T1.m[1]) = (m[1], m[0])[1], m, [1], m[0]",
                "(m[0], m[1], m[2]) = getThree()[0], m, [0], getThree()[0]",
                "(m[0], m[1], m[2]) = getThree()[1], m, [1], getThree()[1]",
                "(m[0], m[1], m[2]) = getThree()[2], m, [2], getThree()[2]",
                "(x, (m[0], m[1], m[2]), y) = (1, getThree(), 2)[1, 0], m, [0], getThree()[0]",
                "(x, (m[0], m[1], m[2]), y) = (1, getThree(), 2)[1, 1], m, [1], getThree()[1]",
                "(x, (m[0], m[1], m[2]), y) = (1, getThree(), 2)[1, 2], m, [2], getThree()[2]",
                "delete m[1], m, [1], undefined"
            ])
        ],
        [
            "structs.sol",
            `
            pragma solidity 0.8.0;

            address constant cosntT = address(0);

            contract T1 {
                struct S {
                    uint x;
                    address a;
                    uint[] arr;
                }

                uint[] arr = [1,2,3];
                S s = S(1, address(0), arr);

                function getTwo() public returns (uint, address) {
                    return (32, address(0x3));
                }

                function structs() public {
                    uint x;
                    uint y;
                    uint z;

                    x = 11;
                    y = 12;
                    z = 13;
                    
                    assert(s.x == 1 && s.a == address(0) && s.arr.length == 3 && s.arr[0] == 1);
                    uint[] memory mArr = new uint[](3);
                    mArr[0] = 42; mArr[1] = 43; mArr[2] = 44;
                    
                    s = S({arr: mArr, a: address(0x10), x: 0});
                    s = S(x, address(0), mArr);
                    
                    assert(s.x == 11 && s.a == address(0) && s.arr.length == 3 && s.arr[0] == 42);
                    
                    s.x = 41;
                    s.a = address(0x1);
                    s.arr[0] = 52;
                    
                    assert(s.x == 41 && s.a == address(0x1) && s.arr.length == 3 && s.arr[0] == 52);
                    
                    (s.x, s.a) = (40, address(0x2));
                    
                    assert(s.x == 40 && s.a == address(0x2) && s.arr.length == 3 && s.arr[0] == 52);
                    
                    (s.x, s.a) = getTwo();
                    
                    assert(s.x == 32 && s.a == address(0x3) && s.arr.length == 3 && s.arr[0] == 52);
                    
                    (x, (s.x, s.a), y) = (1, getTwo(), 2);
                    
                    assert(s.x == 32 && s.a == address(0x3) && s.arr.length == 3 && s.arr[0] == 52);
                    s.arr.push(1);
                    
                    assert(s.x == 32 && s.a == address(0x3) && s.arr.length == 4 && s.arr[3] == 1);
                    s.arr.pop();
                    
                    assert(s.x == 32 && s.a == address(0x3) && s.arr.length == 3);
                    delete s.x;
                    
                    assert(s.x == 0);
                    
                    delete s.arr;
                    
                    assert(s.arr.length == 0);
                    delete s;
                    assert(s.x == 0 && s.a == address(0) && s.arr.length == 0);
                }
            }
            `,
            new Set([
                "uint[] internal arr = [1, 2, 3], arr, [], [1, 2, 3]",
                "S internal s = S(1, address(0), arr), s, [], S(1, address(0), arr)",
                "s = S({arr: mArr, a: address(0x10), x: 0}), s, [], S({arr: mArr, a: address(0x10), x: 0})",
                "s = S(x, address(0), mArr), s, [], S(x, address(0), mArr)",
                "s.x = 41, s, [x], 41",
                "s.a = address(0x1), s, [a], address(0x1)",
                "s.arr[0] = 52, s, [arr, 0], 52",
                "(s.x, s.a) = (40, address(0x2))[0], s, [x], 40",
                "(s.x, s.a) = (40, address(0x2))[1], s, [a], address(0x2)",
                "(s.x, s.a) = getTwo()[0], s, [x], getTwo()[0]",
                "(s.x, s.a) = getTwo()[1], s, [a], getTwo()[1]",
                "(x, (s.x, s.a), y) = (1, getTwo(), 2)[1, 0], s, [x], getTwo()[0]",
                "(x, (s.x, s.a), y) = (1, getTwo(), 2)[1, 1], s, [a], getTwo()[1]",
                "s.arr.push(1), s, [arr], undefined",
                "s.arr.pop(), s, [arr], undefined",
                "delete s.x, s, [x], undefined",
                "delete s.arr, s, [arr], undefined",
                "delete s, s, [], undefined"
            ])
        ]
    ];

    for (const [fileName, content, expectedStateVarUpdates] of samples) {
        it(`Sample #${fileName}`, () => {
            const [sources] = toAst(fileName, content);
            const unit = single(sources);

            const assignments = findStateVarUpdates([unit]);
            const assignmentDescs = new Set([...assignments].map(printStateVarUpdateDesc));
            Logger.debug(
                `Expected aliased set ${pp(expectedStateVarUpdates)} got ${pp([
                    ...assignmentDescs
                ])}`
            );
            expect(assignmentDescs).toEqual(expectedStateVarUpdates);
        });
    }
});
