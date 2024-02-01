import expect from "expect";
import {
    Assignment,
    ASTContext,
    ASTNodeFactory,
    ContractDefinition,
    stringToBytes,
    FunctionDefinition,
    SourceUnit,
    TupleExpression,
    VariableDeclaration,
    XPath
} from "solc-typed-ast";
import { print as printUnits, rewriteImports } from "../../src/ast_to_source_printer";
import {
    findExternalCalls,
    instrumentContract,
    interpose,
    interposeCall,
    interposeInlineInitializer,
    interposeSimpleStateVarUpdate,
    interposeTupleAssignment,
    ScribbleFactory
} from "../../src/instrumenter";
import { InstrumentationSiteType } from "../../src/instrumenter/transpiling_context";
import { single, SolFile } from "../../src/util";
import { findContractAndFun, getTarget, toAst } from "../integration/utils";
import { makeInstrumentationCtx } from "./utils";

function print(units: SourceUnit[], contents: string[], version: string): Map<SourceUnit, string> {
    const contentMap = new Map(
        units.map((unit, idx) => [
            unit.absolutePath,
            new SolFile(unit.absolutePath, stringToBytes(contents[idx]))
        ])
    );
    const context = new ASTContext(...units);
    const factory = new ASTNodeFactory(context);

    units.forEach((unit) => rewriteImports(unit, contentMap, factory));

    return printUnits(units, version, new Map());
}

describe("Function interposing Unit Tests", () => {
    const goodSamples: Array<[string, string, "log" | "mstore", [string, string], string]> = [
        [
            "internal_interpose.sol",
            `pragma solidity 0.6.0;
contract Foo {
    function add(int8 x, uint64 y) internal returns(uint64 add) {
        return uint64(x) + y;
    }
}`,
            "log",
            ["Foo", "add"],
            `pragma solidity 0.6.0;

contract Foo {
    function add(int8 x, uint64 y) internal returns (uint64 add) {
        add = _original_Foo_add(x, y);
    }

    function _original_Foo_add(int8 x, uint64 y) internal returns (uint64 add) {
        return uint64(x) + y;
    }
}`
        ],
        [
            // Interposing on public functions generates 2 wrappers and renames internal calls to the internal wrapper

            "public_interpose.sol",
            `pragma solidity 0.6.0;
contract Foo {
    function main() public {
        add(5,6);
        this.add(6,7);
    }
    function add(int8 x, uint64 y) public returns(uint64 add) {
        return uint64(x) + y;
    }
}

contract Moo is Foo {
    function main1() public {
        add(8,9);
        Foo.add(10,11);
        this.add(12,13);
    }
}
`,
            "log",
            ["Foo", "add"],
            `pragma solidity 0.6.0;

contract Foo {
    function main() public {
        add(5, 6);
        this.add(6, 7);
    }

    function add(int8 x, uint64 y) public returns (uint64 add) {
        add = _original_Foo_add(x, y);
    }

    function _original_Foo_add(int8 x, uint64 y) internal returns (uint64 add) {
        return uint64(x) + y;
    }
}

contract Moo is Foo {
    function main1() public {
        add(8, 9);
        Foo.add(10, 11);
        this.add(12, 13);
    }
}`
        ],
        [
            // Interposing on functions without returns doesn't generate assignments
            "no_returns.sol",
            `pragma solidity 0.6.0;
contract Foo {
    function add(int8 x, uint64 y) external {
        uint64(x) + y;
    }
}`,
            "log",
            ["Foo", "add"],
            `pragma solidity 0.6.0;

contract Foo {
    function add(int8 x, uint64 y) external {
        _original_Foo_add(x, y);
    }

    function _original_Foo_add(int8 x, uint64 y) internal {
        uint64(x) + y;
    }
}`
        ],
        [
            // Functions with multiple returns handled correctly
            "multiple_returns.sol",
            `pragma solidity 0.6.0;
contract Foo {
    function swap(int8 x, uint64 y, address a) external returns (address, int8, uint64){
        return (a, x, y);
    }
}`,
            "log",
            ["Foo", "swap"],
            `pragma solidity 0.6.0;

contract Foo {
    function swap(int8 x, uint64 y, address a) external returns (address RET_0, int8 RET_1, uint64 RET_2) {
        (RET_0, RET_1, RET_2) = _original_Foo_swap(x, y, a);
    }

    function _original_Foo_swap(int8 x, uint64 y, address a) internal returns (address, int8, uint64) {
        return (a, x, y);
    }
}`
        ],
        [
            // Modifiers are added to the stub and stripped from original function (in public case added to both stubs)
            "modifiers.sol",
            `pragma solidity 0.6.0;
contract Foo {
    modifier Dummy {_;}
    function swap(int8 x, uint64 y, address a) public Dummy returns (address, int8, uint64){
        return (a, x, y);
    }
}`,
            "log",
            ["Foo", "swap"],
            `pragma solidity 0.6.0;

contract Foo {
    modifier Dummy() {
        _;
    }

    function swap(int8 x, uint64 y, address a) public returns (address RET_0, int8 RET_1, uint64 RET_2) {
        (RET_0, RET_1, RET_2) = _original_Foo_swap(x, y, a);
    }

    function _original_Foo_swap(int8 x, uint64 y, address a) internal Dummy() returns (address, int8, uint64) {
        return (a, x, y);
    }
}`
        ],
        [
            // In mstore mode interposition doesn't change function visibility
            "mstore1.sol",
            `pragma solidity 0.6.0;
contract Foo {
    function pureF(uint x) public pure returns(uint) {
        return x;
    }
}`,
            "mstore",
            ["Foo", "pureF"],
            `pragma solidity 0.6.0;

contract Foo {
    function pureF(uint x) public pure returns (uint RET_0) {
        RET_0 = _original_Foo_pureF(x);
    }

    function _original_Foo_pureF(uint x) internal pure returns (uint) {
        return x;
    }
}`
        ],
        [
            "calldata_interpose_pre_0.6.9.sol",
            `pragma solidity 0.6.0;
contract Foo {
    function foo(uint[] calldata x) external {
    }
}`,
            "log",
            ["Foo", "foo"],
            `pragma solidity 0.6.0;

contract Foo {
    function foo(uint[] calldata x) external {
        _original_Foo_foo(x);
    }

    function _original_Foo_foo(uint[] memory x) internal {}
}`
        ],
        [
            "calldata_interpose_post_0.6.9.sol",
            `pragma solidity 0.6.9;
contract Foo {
    function foo(uint[] calldata x) external returns (uint[] calldata) {
        return x;
    }
}`,
            "log",
            ["Foo", "foo"],
            `pragma solidity 0.6.9;

contract Foo {
    function foo(uint[] calldata x) external returns (uint[] calldata RET_0) {
        RET_0 = _original_Foo_foo(x);
    }

    function _original_Foo_foo(uint[] calldata x) internal returns (uint[] calldata) {
        return x;
    }
}`
        ],
        [
            /// Anonymous args/returns
            "internal_interpose.sol",
            `pragma solidity 0.6.0;
contract Foo {
    function add(int8, uint64 y) internal returns(uint64) {
        return y+1;
    }
}`,
            "log",
            ["Foo", "add"],
            `pragma solidity 0.6.0;

contract Foo {
    function add(int8 _DUMMY_ARG_0, uint64 y) internal returns (uint64 RET_0) {
        RET_0 = _original_Foo_add(_DUMMY_ARG_0, y);
    }

    function _original_Foo_add(int8, uint64 y) internal returns (uint64) {
        return y + 1;
    }
}`
        ]
    ];
    for (const [
        fileName,
        content,
        assertionMode,
        [contractName, funName],
        expectedInstrumented
    ] of goodSamples) {
        it(`Interpose on ${contractName}.${funName} in #${fileName}`, async () => {
            const { units, reader, files, compilerVersion } = await toAst(fileName, content);
            const target = getTarget([contractName, funName], units);
            const fun = target as FunctionDefinition;
            const factory = new ScribbleFactory(compilerVersion, reader.context);

            const ctx = makeInstrumentationCtx(
                units,
                factory,
                files,
                assertionMode,
                compilerVersion
            );

            interpose(fun, ctx);

            ctx.finalize();

            const instrumented = print(units, [content], "0.6.0").get(units[0]);

            expect(instrumented).toEqual(expectedInstrumented);
        });
    }
});

describe("Contract state invariants interposing unit tests", () => {
    const goodSamples: Array<[string, string, "mstore" | "log", string, string]> = [
        [
            "internal_interpose.sol",
            `pragma solidity 0.6.0;
contract Foo {
    function add(int8 x, uint64 y) internal returns(uint64 add) {
        return uint64(x) + y;
    }
}`,
            "log",
            "Foo",
            `pragma solidity 0.6.0;

contract Foo {
    function add(int8 x, uint64 y) internal returns (uint64 add) {
        return uint64(x) + y;
    }

    /// Check only the current contract's state invariants
    function __scribble_Foo_check_state_invariants_internal() internal {}

    /// Check the state invariant for the current contract and all its bases
    function __scribble_check_state_invariants() virtual internal {
        __scribble_Foo_check_state_invariants_internal();
    }

    constructor() public {
        __ScribbleUtilsLib__20.setInContract(true);
        __scribble_check_state_invariants();
        __ScribbleUtilsLib__20.setInContract(false);
    }
}

library __ScribbleUtilsLib__20 {
    event AssertionFailed(string message);

    event AssertionFailedData(int eventId, bytes encodingData);

    function assertionFailed(string memory arg_0) internal {
        emit AssertionFailed(arg_0);
    }

    function assertionFailedData(int arg_0, bytes memory arg_1) internal {
        emit AssertionFailedData(arg_0, arg_1);
    }

    function isInContract() internal returns (bool res) {
        assembly {
            res := sload(0x5f0b92cf9616afdee4f4136f66393f1343b027f01be893fa569eb2e2b667a40c)
        }
    }

    function setInContract(bool v) internal {
        assembly {
            sstore(0x5f0b92cf9616afdee4f4136f66393f1343b027f01be893fa569eb2e2b667a40c, v)
        }
    }
}`
        ],
        [
            "mstore_interpose.sol",
            `pragma solidity 0.6.0;
contract Foo {
    uint x;
    function pureF(uint id) public pure returns (uint) { return id; }
    function viewF() public view returns (uint) { return x; }
    function mainView(uint y) public view returns (uint) {
        return this.viewF() + this.pureF(y);
    }
}`,
            "mstore",
            "Foo",
            `pragma solidity 0.6.0;

contract Foo {
    uint internal x;

    function pureF(uint id) public pure returns (uint) {
        return id;
    }

    function viewF() public view returns (uint) {
        return x;
    }

    function mainView(uint y) public view returns (uint) {
        return this.viewF() + this.pureF(y);
    }

    /// Check only the current contract's state invariants
    function __scribble_Foo_check_state_invariants_internal() internal view {}

    /// Check the state invariant for the current contract and all its bases
    function __scribble_check_state_invariants() virtual internal view {
        __scribble_Foo_check_state_invariants_internal();
    }

    constructor() public {
        __ScribbleUtilsLib__40.setInContract(true);
        __scribble_check_state_invariants();
        __ScribbleUtilsLib__40.setInContract(false);
    }
}

library __ScribbleUtilsLib__40 {
    event AssertionFailed(string message);

    event AssertionFailedData(int eventId, bytes encodingData);

    function assertionFailed(string memory arg_0) internal {
        emit AssertionFailed(arg_0);
    }

    function assertionFailedData(int arg_0, bytes memory arg_1) internal {
        emit AssertionFailedData(arg_0, arg_1);
    }

    function isInContract() internal returns (bool res) {
        assembly {
            res := sload(0x5f0b92cf9616afdee4f4136f66393f1343b027f01be893fa569eb2e2b667a40c)
        }
    }

    function setInContract(bool v) internal {
        assembly {
            sstore(0x5f0b92cf9616afdee4f4136f66393f1343b027f01be893fa569eb2e2b667a40c, v)
        }
    }
}`
        ]
    ];

    for (const [
        fileName,
        content,
        assertionMode,
        contractName,
        expectedInstrumented
    ] of goodSamples) {
        it(`Instrument ${contractName} in #${fileName}`, async () => {
            const { units, reader, files, compilerVersion } = await toAst(fileName, content);

            const target = getTarget([contractName], units);
            const contract: ContractDefinition = target as ContractDefinition;
            const factory = new ScribbleFactory(compilerVersion, reader.context);

            const ctx = makeInstrumentationCtx(
                units,
                factory,
                files,
                assertionMode,
                compilerVersion
            );

            instrumentContract(ctx, new Map(), [], contract, true);

            ctx.finalize();

            const instrumented = print(units, [content], "0.6.0").get(units[0]);

            expect(instrumented).toEqual(expectedInstrumented);
        });
    }
});

describe("Callsite interposing unit tests", () => {
    const goodSamples: Array<[string, string, "log" | "mstore", [string, string], string]> = [
        [
            "callsite1.sol",
            `pragma solidity 0.6.0;
contract Foo {
    function foo() public {
    }
    function main() public {
        this.foo();
    }
}`,
            "log",
            ["Foo", "main"],
            `pragma solidity 0.6.0;

contract Foo {
    function foo() public {}

    function main() public {
        _callsite_11(this);
    }

    function _callsite_11(Foo receiver) private {
        receiver.foo();
    }
}`
        ],
        [
            "callsite2.sol",
            `pragma solidity 0.6.0;
contract Foo {
    function foo() public returns (uint) {
    }
    function main() public returns (uint) {
        return this.foo();
    }
}`,
            "log",
            ["Foo", "main"],
            `pragma solidity 0.6.0;

contract Foo {
    function foo() public returns (uint) {}

    function main() public returns (uint) {
        return _callsite_14(this);
    }

    function _callsite_14(Foo receiver) private returns (uint256 ret0) {
        (ret0) = receiver.foo();
    }
}`
        ],
        [
            "callsite3.sol",
            `pragma solidity 0.6.0;
contract Foo {
    function inc(int x) public returns (int) {
        return x + 1;
    }
    function main() public returns (int) {
        return this.inc(1) + 1;
    }
}`,
            "log",
            ["Foo", "main"],
            `pragma solidity 0.6.0;

contract Foo {
    function inc(int x) public returns (int) {
        return x + 1;
    }

    function main() public returns (int) {
        return _callsite_21(this, 1) + 1;
    }

    function _callsite_21(Foo receiver, int256 arg0) private returns (int256 ret0) {
        (ret0) = receiver.inc(arg0);
    }
}`
        ],
        [
            "callsite4.sol",
            `pragma solidity 0.6.0;
contract Foo {
    function dup(int x) public returns (int, int) {
        return (x + 1, x+2);
    }
    function main() public returns (int) {
        (int a, int b) = this.dup(4);
        return a+b;
    }
}`,
            "log",
            ["Foo", "main"],
            `pragma solidity 0.6.0;

contract Foo {
    function dup(int x) public returns (int, int) {
        return (x + 1, x + 2);
    }

    function main() public returns (int) {
        (int a, int b) = _callsite_31(this, 4);
        return a + b;
    }

    function _callsite_31(Foo receiver, int256 arg0) private returns (int256 ret0, int256 ret1) {
        (ret0, ret1) = receiver.dup(arg0);
    }
}`
        ],
        [
            "callsite5.sol",
            `pragma solidity 0.6.0;

contract Foo {
    function main(address a) public returns (bytes memory) {
        bytes memory b;
        (bool res, bytes memory data) = a.call(b);
        assert(res);
        return data;
    }
}`,
            "log",
            ["Foo", "main"],
            `pragma solidity 0.6.0;

contract Foo {
    function main(address a) public returns (bytes memory) {
        bytes memory b;
        (bool res, bytes memory data) = _callsite_18(a, b);
        assert(res);
        return data;
    }

    function _callsite_18(address receiver, bytes memory arg0) private returns (bool ret0, bytes memory ret1) {
        (ret0, ret1) = receiver.call(arg0);
    }
}`
        ],
        [
            "mstore_callsite.sol",
            `pragma solidity 0.6.0;

contract Foo {
    uint y;
    function pureF(uint x) public pure returns (uint) {
        return x;
    }

    function main() public {
        this.pureF(1);
    }
}`,
            "mstore",
            ["Foo", "main"],
            `pragma solidity 0.6.0;

contract Foo {
    uint internal y;

    function pureF(uint x) public pure returns (uint) {
        return x;
    }

    function main() public {
        _callsite_20(this, 1);
    }

    function _callsite_20(Foo receiver, uint256 arg0) private pure returns (uint256 ret0) {
        (ret0) = receiver.pureF(arg0);
    }
}`
        ]
    ];

    for (const [
        fileName,
        content,
        assertionMode,
        [contractName, funName],
        expectedInstrumented
    ] of goodSamples) {
        it(`Instrument ${contractName} in #${fileName}`, async () => {
            const { units, reader, files, compilerVersion } = await toAst(fileName, content);
            const [contract, fun] = findContractAndFun(units, contractName, funName);
            const factory = new ScribbleFactory(compilerVersion, reader.context);

            const ctx = makeInstrumentationCtx(
                units,
                factory,
                files,
                assertionMode,
                compilerVersion
            );

            const callSite = single(
                findExternalCalls(fun, ctx.typeEnv.inference),
                `Expect single external callsite per tested function`
            );

            interposeCall(ctx, contract, callSite);

            ctx.finalize();

            const instrumented = print(units, [content], "0.6.0").get(units[0]) as string;

            // Check that the interposed code compiles correctly
            expect(toAst.bind(toAst, "foo.sol", instrumented)).not.toThrow();

            // Check that it equals the expected code
            expect(instrumented).toEqual(expectedInstrumented);
        });
    }
});

describe("State variable interposing Unit Tests", () => {
    const goodSamples: Array<[string, string, string, string]> = [
        [
            "push_pop_interpose.sol",
            `pragma solidity 0.6.0;
contract PushPop{
    uint[] x;
    uint[][] z;
    function main() public {
        x.push(1 + 1);

        x.pop();

        x.push();

        z.push(x);
        uint t = 0;
        z[t].push(1);
    }
}`,
            "//ContractDefinition/FunctionDefinition/Block/ExpressionStatement/FunctionCall",
            `pragma solidity 0.6.0;

contract PushPop {
    uint[] internal x;
    uint[][] internal z;

    function main() public {
        PushPop_x_uint256_push(1 + 1);
        PushPop_x_pop();
        PushPop_x_push_noarg();
        PushPop_z_ptr_arr_uint256_storage_push(x);
        uint t = 0;
        PushPop_z_idx_uint256_uint256_push(t, 1);
    }

    function PushPop_x_uint256_push(uint256 ARG0) internal {
        x.push(ARG0);
    }

    function PushPop_x_pop() internal {
        x.pop();
    }

    function PushPop_x_push_noarg() internal {
        x.push();
    }

    function PushPop_z_ptr_arr_uint256_storage_push(uint256[] storage ARG1) internal {
        z.push(ARG1);
    }

    function PushPop_z_idx_uint256_uint256_push(uint256 ARG2, uint256 ARG3) internal {
        z[ARG2].push(ARG3);
    }
}`
        ],
        [
            "unary_interpose.sol",
            `pragma solidity 0.6.0;
contract Unary {
    int y;
    uint[] x;
    mapping(uint=>uint) m;

    function main() public {
        y = 1;
        assert(y == 1);
        x.push(1);
        assert(x.length == 1);

        delete y;
        assert(y == 0);

        delete x;
        assert(x.length == 0);

        uint t = 1;
        m[t-1] = 1;
        delete m[t-1];
        assert(m[t-1] == 0);

        x.push(1);
        delete x[uint(y)];
        assert(x[uint(y)] == 0);

        assert(0 == y++);
        assert(y == 1);

        assert(0 == --y);

        assert(0 == x[0]++);

        assert(1 == x[0]--);
    }
}
`,
            "//ContractDefinition/FunctionDefinition/Block/ExpressionStatement//UnaryOperation",
            `pragma solidity 0.6.0;

contract Unary {
    int internal y;
    uint[] internal x;
    mapping(uint => uint) internal m;

    function main() public {
        y = 1;
        assert(y == 1);
        x.push(1);
        assert(x.length == 1);
        Unary_y_delete();
        assert(y == 0);
        Unary_x_delete();
        assert(x.length == 0);
        uint t = 1;
        m[t - 1] = 1;
        Unary_m_idx_uint256_delete(t - 1);
        assert(m[t - 1] == 0);
        x.push(1);
        Unary_x_idx_uint256_delete(uint(y));
        assert(x[uint(y)] == 0);
        assert(0 == Unary_y_inc_postfix());
        assert(y == 1);
        assert(0 == Unary_y_dec_prefix());
        assert(0 == Unary_x_idx_uint256_inc_postfix(0));
        assert(1 == Unary_x_idx_uint256_dec_postfix(0));
    }

    function Unary_y_delete() internal {
        delete y;
    }

    function Unary_x_delete() internal {
        delete x;
    }

    function Unary_m_idx_uint256_delete(uint256 ARG0) internal {
        delete m[ARG0];
    }

    function Unary_x_idx_uint256_delete(uint256 ARG1) internal {
        delete x[ARG1];
    }

    function Unary_y_inc_postfix() internal returns (int256 RET0) {
        RET0 = y;
        y++;
    }

    function Unary_y_dec_prefix() internal returns (int256 RET1) {
        --y;
        RET1 = y;
    }

    function Unary_x_idx_uint256_inc_postfix(uint256 ARG2) internal returns (uint256 RET2) {
        RET2 = x[ARG2];
        x[ARG2]++;
    }

    function Unary_x_idx_uint256_dec_postfix(uint256 ARG3) internal returns (uint256 RET3) {
        RET3 = x[ARG3];
        x[ARG3]--;
    }
}`
        ],
        [
            "simple_assignments.sol",
            `pragma solidity 0.6.0;

contract SimpleAssignments {
    uint y;
    uint z;
    uint[] x;
    mapping(uint=>uint) m;

    function plusOne(uint x) public pure returns (uint) {
        return x+1;
    }

    function main() public {
        y = 1;
        assert(y == 1);

        x.push(1);
        x[0] = 2;
        assert(x[0] == 2);

        y = x[0] = 3;
        assert(y == 3 && x[0] == 3);

        y += x[0] -= 3;
        assert(y == 3 && x[0] == 0);

        x[y-=3] = 1;
        assert(y == 0 && x[0] == 1);

        y = plusOne(x[y] = 5);
        assert(x[0] == 5 && y == 6);

        for (z = 0; z < y; z = z + 1) {}
    }
}
`,
            "//ContractDefinition/FunctionDefinition/Block//Assignment",
            `pragma solidity 0.6.0;

contract SimpleAssignments {
    uint internal y;
    uint internal z;
    uint[] internal x;
    mapping(uint => uint) internal m;

    function plusOne(uint x) public pure returns (uint) {
        return x + 1;
    }

    function main() public {
        SimpleAssignments_y_uint256_assign(1);
        assert(y == 1);
        x.push(1);
        SimpleAssignments_x_idx_uint256_uint256_assign(0, 2);
        assert(x[0] == 2);
        SimpleAssignments_y_uint256_assign(SimpleAssignments_x_idx_uint256_uint256_assign(0, 3));
        assert((y == 3) && (x[0] == 3));
        SimpleAssignments_y_uint256_plus_assign(SimpleAssignments_x_idx_uint256_uint256_minus_assign(0, 3));
        assert((y == 3) && (x[0] == 0));
        SimpleAssignments_x_idx_uint256_uint256_assign(SimpleAssignments_y_uint256_minus_assign(3), 1);
        assert((y == 0) && (x[0] == 1));
        SimpleAssignments_y_uint256_assign(plusOne(SimpleAssignments_x_idx_uint256_uint256_assign(y, 5)));
        assert((x[0] == 5) && (y == 6));
        for (SimpleAssignments_z_uint256_assign(0); z < y; SimpleAssignments_z_uint256_assign(z + 1)) {}
    }

    function SimpleAssignments_y_uint256_assign(uint256 ARG0) internal returns (uint256 RET0) {
        y = ARG0;
        RET0 = y;
    }

    function SimpleAssignments_x_idx_uint256_uint256_assign(uint256 ARG1, uint256 ARG2) internal returns (uint256 RET1) {
        x[ARG1] = ARG2;
        RET1 = x[ARG1];
    }

    function SimpleAssignments_y_uint256_plus_assign(uint256 ARG3) internal returns (uint256 RET2) {
        y += ARG3;
        RET2 = y;
    }

    function SimpleAssignments_x_idx_uint256_uint256_minus_assign(uint256 ARG4, uint256 ARG5) internal returns (uint256 RET3) {
        x[ARG4] -= ARG5;
        RET3 = x[ARG4];
    }

    function SimpleAssignments_y_uint256_minus_assign(uint256 ARG6) internal returns (uint256 RET4) {
        y -= ARG6;
        RET4 = y;
    }

    function SimpleAssignments_z_uint256_assign(uint256 ARG7) internal returns (uint256 RET5) {
        z = ARG7;
        RET5 = z;
    }
}`
        ],
        [
            "tuple_assignments.sol",
            `pragma solidity 0.6.0;

contract TupleAssignments {
    uint x;
    uint y;
    uint[] a;
    uint[][] aa;

    function getTwo() internal pure returns (uint, uint) {
        return (3, 4);
    }

    function main() public {
        (x, y) = (1, 2);
        assert(x == 1 && y == 2);
        (x, y) = (y, x);
        assert(x == 2 && y == 1);
        
        (x, y) = getTwo();
        assert(x == 3 && y == 4);
        
        (x, x) = getTwo();
        assert(x == 3 && y == 4);
        
        (x, (x ,x)) = (1, (2, 3));
        
        assert(x == 1);
        
        ((x, x), x) = ((2, 3), 1);
        
        assert(x == 2);

        a.push(42);
        a.push(41);
        assert(a[0] == 42 && a[1] == 41);

        uint t = 0;
        (a[t], t) = (2, 1);

        assert(t == 1 && a[0] == 2);
        
        (t, a[t]) = (0, 3);

        assert(t == 0 && a[1] == 3);
        
        x = 0;
        (a[x], x) = (4, 1);

        assert(x == 1 && a[0] == 4);
        
        aa.push(a);
        x  = y = 0;
        (x, aa[x][y], y) = (10, 5, 10);
    
        assert(x == 10 && y == 10 && aa[0][0] == 5);
    }
}
`,
            "//ContractDefinition/FunctionDefinition/Block//Assignment",
            `pragma solidity 0.6.0;

contract TupleAssignments {
    struct vars0 {
        uint256 tuple_tmp_0;
        uint256 tuple_tmp_1;
        uint256 tuple_tmp_2;
        uint256 tuple_tmp_3;
        uint256 tuple_tmp_4;
        uint256 tuple_tmp_5;
        uint256 tuple_tmp_6;
        uint256 tuple_tmp_7;
        uint256 tuple_tmp_8;
        uint256 tuple_tmp_9;
        uint256 tuple_tmp_10;
        uint256 tuple_tmp_11;
        uint256 tuple_tmp_12;
        uint256 tuple_tmp_13;
        uint256 tuple_tmp_14;
        uint256 tuple_tmp_15;
        uint256 tuple_tmp_16;
        uint256 tuple_tmp_17;
        uint256 tuple_tmp_18;
        uint256 tuple_tmp_19;
        uint256 tuple_tmp_20;
        uint256 tuple_tmp_21;
        uint256 tuple_tmp_22;
        uint256 tuple_tmp_23;
        uint256 tuple_tmp_24;
        uint256 tuple_tmp_25;
        uint256 tuple_tmp_26;
        uint256 tuple_tmp_27;
    }

    uint internal x;
    uint internal y;
    uint[] internal a;
    uint[][] internal aa;

    function getTwo() internal pure returns (uint, uint) {
        return (3, 4);
    }

    function main() public {
        vars0 memory _v;
        (_v.tuple_tmp_1, _v.tuple_tmp_0) = (1, 2);
        TupleAssignments_y_uint256_assign(_v.tuple_tmp_0);
        TupleAssignments_x_uint256_assign(_v.tuple_tmp_1);
        assert((x == 1) && (y == 2));
        (_v.tuple_tmp_3, _v.tuple_tmp_2) = (y, x);
        TupleAssignments_y_uint256_assign(_v.tuple_tmp_2);
        TupleAssignments_x_uint256_assign(_v.tuple_tmp_3);
        assert((x == 2) && (y == 1));
        (_v.tuple_tmp_5, _v.tuple_tmp_4) = getTwo();
        TupleAssignments_y_uint256_assign(_v.tuple_tmp_4);
        TupleAssignments_x_uint256_assign(_v.tuple_tmp_5);
        assert((x == 3) && (y == 4));
        (_v.tuple_tmp_7, _v.tuple_tmp_6) = getTwo();
        TupleAssignments_x_uint256_assign(_v.tuple_tmp_6);
        TupleAssignments_x_uint256_assign(_v.tuple_tmp_7);
        assert((x == 3) && (y == 4));
        (_v.tuple_tmp_10, (_v.tuple_tmp_9, _v.tuple_tmp_8)) = (1, (2, 3));
        TupleAssignments_x_uint256_assign(_v.tuple_tmp_8);
        TupleAssignments_x_uint256_assign(_v.tuple_tmp_9);
        TupleAssignments_x_uint256_assign(_v.tuple_tmp_10);
        assert(x == 1);
        ((_v.tuple_tmp_13, _v.tuple_tmp_12), _v.tuple_tmp_11) = ((2, 3), 1);
        TupleAssignments_x_uint256_assign(_v.tuple_tmp_11);
        TupleAssignments_x_uint256_assign(_v.tuple_tmp_12);
        TupleAssignments_x_uint256_assign(_v.tuple_tmp_13);
        assert(x == 2);
        a.push(42);
        a.push(41);
        assert((a[0] == 42) && (a[1] == 41));
        uint t = 0;
        _v.tuple_tmp_16 = t;
        (_v.tuple_tmp_15, _v.tuple_tmp_14) = (2, 1);
        t = _v.tuple_tmp_14;
        TupleAssignments_a_idx_uint256_uint256_assign(_v.tuple_tmp_16, _v.tuple_tmp_15);
        assert((t == 1) && (a[0] == 2));
        _v.tuple_tmp_18 = t;
        (_v.tuple_tmp_19, _v.tuple_tmp_17) = (0, 3);
        TupleAssignments_a_idx_uint256_uint256_assign(_v.tuple_tmp_18, _v.tuple_tmp_17);
        t = _v.tuple_tmp_19;
        assert((t == 0) && (a[1] == 3));
        TupleAssignments_x_uint256_assign(0);
        _v.tuple_tmp_22 = x;
        (_v.tuple_tmp_21, _v.tuple_tmp_20) = (4, 1);
        TupleAssignments_x_uint256_assign(_v.tuple_tmp_20);
        TupleAssignments_a_idx_uint256_uint256_assign(_v.tuple_tmp_22, _v.tuple_tmp_21);
        assert((x == 1) && (a[0] == 4));
        aa.push(a);
        TupleAssignments_x_uint256_assign(TupleAssignments_y_uint256_assign(0));
        _v.tuple_tmp_25 = x;
        _v.tuple_tmp_26 = y;
        (_v.tuple_tmp_27, _v.tuple_tmp_24, _v.tuple_tmp_23) = (10, 5, 10);
        TupleAssignments_y_uint256_assign(_v.tuple_tmp_23);
        TupleAssignments_aa_idx_uint256_idx_uint256_uint256_assign(_v.tuple_tmp_25, _v.tuple_tmp_26, _v.tuple_tmp_24);
        TupleAssignments_x_uint256_assign(_v.tuple_tmp_27);
        assert(((x == 10) && (y == 10)) && (aa[0][0] == 5));
    }

    function TupleAssignments_y_uint256_assign(uint256 ARG0) internal returns (uint256 RET0) {
        y = ARG0;
        RET0 = y;
    }

    function TupleAssignments_x_uint256_assign(uint256 ARG1) internal returns (uint256 RET1) {
        x = ARG1;
        RET1 = x;
    }

    function TupleAssignments_a_idx_uint256_uint256_assign(uint256 ARG2, uint256 ARG3) internal returns (uint256 RET2) {
        a[ARG2] = ARG3;
        RET2 = a[ARG2];
    }

    function TupleAssignments_aa_idx_uint256_idx_uint256_uint256_assign(uint256 ARG4, uint256 ARG5, uint256 ARG6) internal returns (uint256 RET3) {
        aa[ARG4][ARG5] = ARG6;
        RET3 = aa[ARG4][ARG5];
    }
}`
        ],
        [
            "inherited_vars.sol",
            `pragma solidity 0.6.0;

contract Base {
    uint x;

    function main() public {
        x = 1;
    }
}

contract Child is Base{
    function main1() public {
        x = 2;
    }
}
`,
            "//ContractDefinition/FunctionDefinition/Block//Assignment",
            `pragma solidity 0.6.0;

contract Base {
    uint internal x;

    function main() public {
        Base_x_uint256_assign(1);
    }

    function Base_x_uint256_assign(uint256 ARG0) internal returns (uint256 RET0) {
        x = ARG0;
        RET0 = x;
    }
}

contract Child is Base {
    function main1() public {
        Base_x_uint256_assign(2);
    }
}`
        ],
        [
            "complex_datastructures_assign.sol",
            `pragma solidity 0.6.0;

contract ComplexDatastructures {
    struct T {
        uint[] z;
        string a;
    }
    uint[] a;
    uint[][] aa;
    mapping(uint => uint) m1;
    mapping(uint => uint) m2;
    string s;
    bytes b;
    
    function main() public {
        s = "abcd";
        b = new bytes(5);
        
        a = [1,2,3];
        
        a = a;
        
        mapping(uint => uint) storage p1 = m1;
        
        uint t;
        (s, b, t) = ("def", new bytes(4), 1);
        
        aa.push(a);
        
        (aa[0], aa[0][0]) = (a, 5);
        assert(aa[0][0] == 1);
    }
}
`,
            "//ContractDefinition/FunctionDefinition/Block//Assignment",
            `pragma solidity 0.6.0;

contract ComplexDatastructures {
    struct T {
        uint[] z;
        string a;
    }

    struct vars0 {
        uint256 tuple_tmp_0;
        bytes tuple_tmp_1;
        string tuple_tmp_2;
        uint256 tuple_tmp_3;
        uint256 tuple_tmp_4;
        uint256 tuple_tmp_5;
        uint256[] tuple_tmp_6;
        uint256 tuple_tmp_7;
    }

    uint[] internal a;
    uint[][] internal aa;
    mapping(uint => uint) internal m1;
    mapping(uint => uint) internal m2;
    string internal s;
    bytes internal b;

    function main() public {
        vars0 memory _v;
        ComplexDatastructures_s_ptr_string_memory_assign("abcd");
        ComplexDatastructures_b_ptr_bytes_memory_assign(new bytes(5));
        ComplexDatastructures_a_ptr_arr_uint8_3_memory_assign([1, 2, 3]);
        ComplexDatastructures_a_ptr_arr_uint256_storage_assign(a);
        mapping(uint => uint) storage p1 = m1;
        uint t;
        (_v.tuple_tmp_2, _v.tuple_tmp_1, _v.tuple_tmp_0) = ("def", new bytes(4), 1);
        t = _v.tuple_tmp_0;
        ComplexDatastructures_b_ptr_bytes_memory_assign(_v.tuple_tmp_1);
        ComplexDatastructures_s_ptr_string_memory_assign(_v.tuple_tmp_2);
        aa.push(a);
        _v.tuple_tmp_4 = 0;
        _v.tuple_tmp_5 = 0;
        _v.tuple_tmp_7 = 0;
        (_v.tuple_tmp_6, _v.tuple_tmp_3) = (a, 5);
        ComplexDatastructures_aa_idx_uint256_idx_uint256_uint256_assign(_v.tuple_tmp_4, _v.tuple_tmp_5, _v.tuple_tmp_3);
        ComplexDatastructures_aa_idx_uint256_ptr_arr_uint256_memory_assign(_v.tuple_tmp_7, _v.tuple_tmp_6);
        assert(aa[0][0] == 1);
    }

    function ComplexDatastructures_s_ptr_string_memory_assign(string memory ARG0) internal returns (string storage RET0) {
        s = ARG0;
        RET0 = s;
    }

    function ComplexDatastructures_b_ptr_bytes_memory_assign(bytes memory ARG1) internal returns (bytes storage RET1) {
        b = ARG1;
        RET1 = b;
    }

    function ComplexDatastructures_a_ptr_arr_uint8_3_memory_assign(uint8[3] memory ARG2) internal returns (uint256[] storage RET2) {
        a = ARG2;
        RET2 = a;
    }

    function ComplexDatastructures_a_ptr_arr_uint256_storage_assign(uint256[] storage ARG3) internal returns (uint256[] storage RET3) {
        a = ARG3;
        RET3 = a;
    }

    function ComplexDatastructures_aa_idx_uint256_idx_uint256_uint256_assign(uint256 ARG4, uint256 ARG5, uint256 ARG6) internal returns (uint256 RET4) {
        aa[ARG4][ARG5] = ARG6;
        RET4 = aa[ARG4][ARG5];
    }

    function ComplexDatastructures_aa_idx_uint256_ptr_arr_uint256_memory_assign(uint256 ARG7, uint256[] memory ARG8) internal returns (uint256[] storage RET5) {
        aa[ARG7] = ARG8;
        RET5 = aa[ARG7];
    }
}`
        ],
        [
            "storage_pointer_var.sol",
            `pragma solidity 0.6.0;

contract Foo {
    uint[] x;
    uint y;
    function main() public {
        uint[] storage ptr = x;
        
        (x, y) = (x, 1);
}
}
`,
            "//ContractDefinition/FunctionDefinition/Block//Assignment",
            `pragma solidity 0.6.0;

contract Foo {
    struct vars0 {
        uint256 tuple_tmp_0;
        uint256[] tuple_tmp_1;
    }

    uint[] internal x;
    uint internal y;

    function main() public {
        vars0 memory _v;
        uint[] storage ptr = x;
        (_v.tuple_tmp_1, _v.tuple_tmp_0) = (x, 1);
        Foo_y_uint256_assign(_v.tuple_tmp_0);
        Foo_x_ptr_arr_uint256_memory_assign(_v.tuple_tmp_1);
    }

    function Foo_y_uint256_assign(uint256 ARG0) internal returns (uint256 RET0) {
        y = ARG0;
        RET0 = y;
    }

    function Foo_x_ptr_arr_uint256_memory_assign(uint256[] memory ARG1) internal returns (uint256[] storage RET1) {
        x = ARG1;
        RET1 = x;
    }
}`
        ],
        [
            "complex_datastructures_assign.sol",
            `pragma solidity 0.6.0;

contract Foo {
    uint y;
    function retOne() internal returns (uint) {
        return y = 1;
    }

    function main() public {
        uint t = retOne();
    }
}
`,
            "//ContractDefinition/FunctionDefinition/Block//Assignment",
            `pragma solidity 0.6.0;

contract Foo {
    uint internal y;

    function retOne() internal returns (uint) {
        return Foo_y_uint256_assign(1);
    }

    function main() public {
        uint t = retOne();
    }

    function Foo_y_uint256_assign(uint256 ARG0) internal returns (uint256 RET0) {
        y = ARG0;
        RET0 = y;
    }
}`
        ],
        [
            "structs_assign.sol",
            `pragma solidity 0.6.0;

contract Foo {
    struct Simple {
        uint x;
        uint y;
    }

    struct Complex {
        uint len;
        uint[] arr;
    }

    Simple sV;
    Simple sV1;
    Complex cV;
    Complex cV1;

    function simple_tests() public {
        sV.x = 0;
        sV.y = 1;

        assert(sV.x == 0 && sV.y == 1);
        (sV.x, sV.y) = (3, 4);
        assert(sV.x == 3 && sV.y == 4);
        (sV.x, sV.y) = (sV.y, sV.x);
        assert(sV.x == 4 && sV.y == 3);

        sV = Simple({x: 5, y: 6});
        assert(sV.x == 5 && sV.y == 6);

        Simple memory mV = Simple({x: 7, y: 8});
        sV = mV;
        assert(sV.x == 7 && sV.y == 8);

        sV1 = sV;
        assert(sV1.x == 7 && sV1.y == 8);
    }

    function complex_tests() public {
        cV.len = 3;
        cV.arr = [1,2,3];
        assert(cV.len == 3 && cV.arr.length == 3);

        uint[] memory m = new uint[](2);
        cV = Complex(2, m);
        assert(cV.len == 2 && cV.arr.length == 2);
        
        cV1 = cV;
        assert(cV1.len == 2 && cV1.arr.length == 2);
        Complex memory mV = Complex(3, m);
        cV = mV;
        assert(cV.len == 3 && cV.arr.length == 2);
    }

    function main() public {
        simple_tests();
        complex_tests();
    }
}
`,
            "//ContractDefinition/FunctionDefinition/Block//Assignment",
            `pragma solidity 0.6.0;

contract Foo {
    struct Simple {
        uint x;
        uint y;
    }

    struct Complex {
        uint len;
        uint[] arr;
    }

    struct vars0 {
        uint256 tuple_tmp_0;
        uint256 tuple_tmp_1;
        uint256 tuple_tmp_2;
        uint256 tuple_tmp_3;
    }

    Simple internal sV;
    Simple internal sV1;
    Complex internal cV;
    Complex internal cV1;

    function simple_tests() public {
        vars0 memory _v;
        Foo_sV_x_uint256_assign(0);
        Foo_sV_y_uint256_assign(1);
        assert((sV.x == 0) && (sV.y == 1));
        (_v.tuple_tmp_1, _v.tuple_tmp_0) = (3, 4);
        Foo_sV_y_uint256_assign(_v.tuple_tmp_0);
        Foo_sV_x_uint256_assign(_v.tuple_tmp_1);
        assert((sV.x == 3) && (sV.y == 4));
        (_v.tuple_tmp_3, _v.tuple_tmp_2) = (sV.y, sV.x);
        Foo_sV_y_uint256_assign(_v.tuple_tmp_2);
        Foo_sV_x_uint256_assign(_v.tuple_tmp_3);
        assert((sV.x == 4) && (sV.y == 3));
        Foo_sV_ptr_ud_Foo_Simple_memory_assign(Simple({x: 5, y: 6}));
        assert((sV.x == 5) && (sV.y == 6));
        Simple memory mV = Simple({x: 7, y: 8});
        Foo_sV_ptr_ud_Foo_Simple_memory_assign(mV);
        assert((sV.x == 7) && (sV.y == 8));
        Foo_sV1_ptr_ud_Foo_Simple_storage_assign(sV);
        assert((sV1.x == 7) && (sV1.y == 8));
    }

    function complex_tests() public {
        Foo_cV_len_uint256_assign(3);
        Foo_cV_arr_ptr_arr_uint8_3_memory_assign([1, 2, 3]);
        assert((cV.len == 3) && (cV.arr.length == 3));
        uint[] memory m = new uint[](2);
        Foo_cV_ptr_ud_Foo_Complex_memory_assign(Complex(2, m));
        assert((cV.len == 2) && (cV.arr.length == 2));
        Foo_cV1_ptr_ud_Foo_Complex_storage_assign(cV);
        assert((cV1.len == 2) && (cV1.arr.length == 2));
        Complex memory mV = Complex(3, m);
        Foo_cV_ptr_ud_Foo_Complex_memory_assign(mV);
        assert((cV.len == 3) && (cV.arr.length == 2));
    }

    function main() public {
        simple_tests();
        complex_tests();
    }

    function Foo_sV_x_uint256_assign(uint256 ARG0) internal returns (uint256 RET0) {
        sV.x = ARG0;
        RET0 = sV.x;
    }

    function Foo_sV_y_uint256_assign(uint256 ARG1) internal returns (uint256 RET1) {
        sV.y = ARG1;
        RET1 = sV.y;
    }

    function Foo_sV_ptr_ud_Foo_Simple_memory_assign(Foo.Simple memory ARG2) internal returns (Foo.Simple storage RET2) {
        sV = ARG2;
        RET2 = sV;
    }

    function Foo_sV1_ptr_ud_Foo_Simple_storage_assign(Foo.Simple storage ARG3) internal returns (Foo.Simple storage RET3) {
        sV1 = ARG3;
        RET3 = sV1;
    }

    function Foo_cV_len_uint256_assign(uint256 ARG4) internal returns (uint256 RET4) {
        cV.len = ARG4;
        RET4 = cV.len;
    }

    function Foo_cV_arr_ptr_arr_uint8_3_memory_assign(uint8[3] memory ARG5) internal returns (uint256[] storage RET5) {
        cV.arr = ARG5;
        RET5 = cV.arr;
    }

    function Foo_cV_ptr_ud_Foo_Complex_memory_assign(Foo.Complex memory ARG6) internal returns (Foo.Complex storage RET6) {
        cV = ARG6;
        RET6 = cV;
    }

    function Foo_cV1_ptr_ud_Foo_Complex_storage_assign(Foo.Complex storage ARG7) internal returns (Foo.Complex storage RET7) {
        cV1 = ARG7;
        RET7 = cV1;
    }
}`
        ],
        [
            "signleton_tuple.sol",
            `pragma solidity 0.6.0;

contract Foo {
    uint x;
    function main() public {
        (x) = (1);
        assert(x == 1);

        (x) = 2;
        assert(x == 2);

        uint t;
        int r;

        (r, (t, ((x)))) = (1, (2, 3));

        assert(x == 3);
    }
}
`,
            "//ContractDefinition/FunctionDefinition/Block//Assignment",
            `pragma solidity 0.6.0;

contract Foo {
    struct vars0 {
        uint256 tuple_tmp_0;
        uint256 tuple_tmp_1;
        uint256 tuple_tmp_2;
        uint256 tuple_tmp_3;
        int256 tuple_tmp_4;
    }

    uint internal x;

    function main() public {
        vars0 memory _v;
        (_v.tuple_tmp_0) = (1);
        Foo_x_uint256_assign(_v.tuple_tmp_0);
        assert(x == 1);
        (_v.tuple_tmp_1) = 2;
        Foo_x_uint256_assign(_v.tuple_tmp_1);
        assert(x == 2);
        uint t;
        int r;
        (_v.tuple_tmp_4, (_v.tuple_tmp_3, ((_v.tuple_tmp_2)))) = (1, (2, 3));
        Foo_x_uint256_assign(_v.tuple_tmp_2);
        t = _v.tuple_tmp_3;
        r = _v.tuple_tmp_4;
        assert(x == 3);
    }

    function Foo_x_uint256_assign(uint256 ARG0) internal returns (uint256 RET0) {
        x = ARG0;
        RET0 = x;
    }
}`
        ],
        [
            "inline_initializer.sol",
            `pragma solidity 0.6.0;

contract Foo {
    uint x = 1;
    constructor() public {
        x = 2;
    }
}

contract Child is Foo {
    uint y = 1;
}
`,
            "//ContractDefinition/VariableDeclaration",
            `pragma solidity 0.6.0;

contract Foo {
    uint internal x = 1;

    constructor() public {
        Foo_x_inline_initializer();
        x = 2;
    }

    function Foo_x_inline_initializer() internal {}
}

contract Child is Foo {
    uint internal y = 1;

    function Child_y_inline_initializer() internal {}

    constructor() public {
        Child_y_inline_initializer();
    }
}`
        ]
    ];
    for (const [fileName, content, selector, expectedInstrumented] of goodSamples) {
        it(`Interpose on state vars in #${fileName}`, async () => {
            const { units, reader, files, compilerVersion } = await toAst(fileName, content);
            const result = new XPath(units[0]).query(selector);
            const nodes = result instanceof Array ? result : [result];
            const factory = new ScribbleFactory(compilerVersion, reader.context);
            const contract = units[0].vContracts[0];
            const vars = new Set(contract.vStateVariables);

            const ctx = makeInstrumentationCtx(units, factory, files, "log", compilerVersion);
            for (const node of nodes) {
                if (node instanceof Assignment && node.vLeftHandSide instanceof TupleExpression) {
                    const container = node.getClosestParentByType(
                        FunctionDefinition
                    ) as FunctionDefinition;

                    const transCtx = ctx.transCtxMap.get(
                        container,
                        InstrumentationSiteType.TwoPointWrapper
                    );

                    interposeTupleAssignment(transCtx, node, vars);
                } else if (node instanceof VariableDeclaration) {
                    interposeInlineInitializer(ctx, node);
                } else {
                    interposeSimpleStateVarUpdate(ctx, node);
                }
            }

            ctx.finalize();

            const instrumented = print(units, [content], "0.6.0").get(units[0]);

            expect(instrumented).toEqual(expectedInstrumented);
        });
    }
});
