import {
    Assignment,
    ASTContext,
    ASTNodeFactory,
    ContractDefinition,
    FunctionCall,
    FunctionDefinition,
    SourceUnit,
    TupleExpression,
    XPath
} from "solc-typed-ast";
import expect from "expect";
import { print as printUnits, rewriteImports } from "../../src/ast_to_source_printer";
import {
    ContractInstrumenter,
    findExternalCalls,
    generateUtilsContract,
    interpose,
    interposeCall,
    interposeSimpleStateVarUpdate,
    interposeTupleAssignment
} from "../../src/instrumenter";
import { cook } from "../../src/rewriter";
import { single } from "../../src/util";
import { getTarget, getTypeCtx, toAst } from "../integration/utils";
import { getCallGraph } from "../../src/instrumenter/callgraph";
import { getCHA } from "../../src/instrumenter/cha";
import { InstrumentationContext } from "../../src/instrumenter/instrumentation_context";
import { TypeEnv } from "../../src/spec-lang/tc";

export type LocationDesc = [string, string];

function makeInstrumentationCtx(
    sources: SourceUnit[],
    factory: ASTNodeFactory,
    files: Map<string, string>,
    assertionMode: "log" | "mstore",
    compilerVersion: string
): InstrumentationContext {
    const ctx = new InstrumentationContext(
        factory,
        sources,
        assertionMode,
        true,
        getCallGraph(sources),
        getCHA(sources),
        new Set(),
        {},
        [],
        new Map(),
        files,
        compilerVersion,
        false,
        new Map(),
        "flat",
        new TypeEnv(),
        new Map()
    );

    generateUtilsContract(factory, "", "scribble_utils.sol", compilerVersion, ctx).vContracts;
    return ctx;
}

function print(units: SourceUnit[], contents: string[], version: string): Map<SourceUnit, string> {
    const contentMap = new Map(units.map((unit, idx) => [unit.absolutePath, contents[idx]]));
    const context = new ASTContext(...units);
    const factory = new ASTNodeFactory(context);

    units.forEach((unit) => rewriteImports(unit, contentMap, factory));
    const verMap: Map<SourceUnit, string> = new Map(units.map((unit) => [unit, version]));

    return printUnits(units, verMap, new Map());
}

describe("Function interposing Unit Tests", () => {
    const goodSamples: Array<[string, string, "log" | "mstore", LocationDesc, string]> = [
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

    function _original_Foo_add(int8 x, uint64 y) private returns (uint64 add) {
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

    function _original_Foo_add(int8 x, uint64 y) private returns (uint64 add) {
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

    function _original_Foo_add(int8 x, uint64 y) private {
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

    function _original_Foo_swap(int8 x, uint64 y, address a) private returns (address, int8, uint64) {
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

    function _original_Foo_swap(int8 x, uint64 y, address a) private Dummy() returns (address, int8, uint64) {
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

    function _original_Foo_pureF(uint x) private pure returns (uint) {
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

    function _original_Foo_foo(uint[] memory x) private {}
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

    function _original_Foo_foo(uint[] calldata x) private returns (uint[] calldata) {
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

    function _original_Foo_add(int8, uint64 y) private returns (uint64) {
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
        it(`Interpose on ${contractName}.${funName} in #${fileName}`, () => {
            const [sources, reader, files, compilerVersion] = toAst(fileName, content);
            const typeCtx = getTypeCtx([contractName, funName], sources);
            const fun: FunctionDefinition = getTarget(typeCtx) as FunctionDefinition;
            const factory = new ASTNodeFactory(reader.context);

            const ctx = makeInstrumentationCtx(
                sources,
                factory,
                files,
                assertionMode,
                compilerVersion
            );
            const [recipe] = interpose(fun, ctx);
            cook(recipe);

            ctx.finalize();

            const instrumented = print(sources, [content], "0.6.0").get(sources[0]);
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

import "./scribble_utils.sol";

contract Foo is __scribble_ReentrancyUtils {
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
        __scribble_out_of_contract = false;
        __scribble_check_state_invariants();
        __scribble_out_of_contract = true;
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

import "./scribble_utils.sol";

contract Foo is __scribble_ReentrancyUtils {
    uint internal x;

    function pureF(uint id) public pure returns (uint) {
        return id;
    }

    function viewF() public view returns (uint) {
        return x;
    }

    function mainView(uint y) public view returns (uint) {
        return _callsite_30(this.viewF) + this.pureF(y);
    }

    /// Check only the current contract's state invariants
    function __scribble_Foo_check_state_invariants_internal() internal view {}

    /// Check the state invariant for the current contract and all its bases
    function __scribble_check_state_invariants() virtual internal view {
        __scribble_Foo_check_state_invariants_internal();
    }

    constructor() public {
        __scribble_out_of_contract = false;
        __scribble_check_state_invariants();
        __scribble_out_of_contract = true;
    }

    function _callsite_30(function() external view returns (uint) fPtr) private view returns (uint ret0) {
        __scribble_check_state_invariants();
        (ret0) = fPtr();
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
        it(`Instrument ${contractName} in #${fileName}`, () => {
            const [sources, reader, files, compilerVersion] = toAst(fileName, content);

            const typeCtx = getTypeCtx([contractName, undefined], sources);
            const contract: ContractDefinition = getTarget(typeCtx) as ContractDefinition;
            const factory = new ASTNodeFactory(reader.context);
            const contractInstrumenter = new ContractInstrumenter();

            const ctx = makeInstrumentationCtx(
                sources,
                factory,
                files,
                assertionMode,
                compilerVersion
            );
            contractInstrumenter.instrument(ctx, [], contract);
            ctx.finalize();

            const instrumented = print(sources, [content], "0.6.0").get(sources[0]);

            expect(instrumented).toEqual(expectedInstrumented);
        });
    }
});

describe("Callsite interposing unit tests", () => {
    const goodSamples: Array<[string, string, "log" | "mstore", LocationDesc, string]> = [
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
        _callsite_11(this.foo);
    }

    function _callsite_11(function() external fPtr) private {
        fPtr();
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
        return _callsite_14(this.foo);
    }

    function _callsite_14(function() external returns (uint) fPtr) private returns (uint ret0) {
        (ret0) = fPtr();
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
        return _callsite_21(this.inc, 1) + 1;
    }

    function _callsite_21(function(int) external returns (int) fPtr, int arg0) private returns (int ret0) {
        (ret0) = fPtr(arg0);
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
        (int a, int b) = _callsite_31(this.dup, 4);
        return a + b;
    }

    function _callsite_31(function(int) external returns (int, int) fPtr, int arg0) private returns (int ret0, int ret1) {
        (ret0, ret1) = fPtr(arg0);
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
        _callsite_20(this.pureF, 1);
    }

    function _callsite_20(function(uint) external pure returns (uint) fPtr, uint arg0) private pure returns (uint ret0) {
        (ret0) = fPtr(arg0);
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
        it(`Instrument ${contractName} in #${fileName}`, () => {
            const [sources, reader, files, compilerVersion] = toAst(fileName, content);
            const typeCtx = getTypeCtx([contractName, funName], sources);
            const contract: ContractDefinition = typeCtx[1] as ContractDefinition;
            const fun: FunctionDefinition = getTarget(typeCtx) as FunctionDefinition;
            const factory = new ASTNodeFactory(reader.context);

            const callSite: FunctionCall = single(
                findExternalCalls(fun),
                `Expect single external callsite per tested function`
            );

            const ctx = makeInstrumentationCtx(
                sources,
                factory,
                files,
                assertionMode,
                compilerVersion
            );
            const [recipe] = interposeCall(ctx, contract, callSite);
            cook(recipe);

            ctx.finalize();

            const instrumented = print(sources, [content], "0.6.0").get(sources[0]) as string;

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
        PushPop_x_push(1 + 1);
        PushPop_x_pop();
        PushPop_x_push_noarg();
        PushPop_z_push(x);
        uint t = 0;
        PushPop_z_idx_push(t, 1);
    }

    function PushPop_x_push(uint ARG0) internal {
        x.push(ARG0);
    }

    function PushPop_x_pop() internal {
        x.pop();
    }

    function PushPop_x_push_noarg() internal {
        x.push();
    }

    function PushPop_z_push(uint[] memory ARG1) internal {
        z.push(ARG1);
    }

    function PushPop_z_idx_push(uint256 ARG2, uint ARG3) internal {
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
        Unary_m_idx_delete(t - 1);
        assert(m[t - 1] == 0);
        x.push(1);
        Unary_x_idx_delete(uint(y));
        assert(x[uint(y)] == 0);
        assert(0 == Unary_y_inc__postfix());
        assert(y == 1);
        assert(0 == Unary_y_dec__prefix());
        assert(0 == Unary_x_idx_inc__postfix(0));
        assert(1 == Unary_x_idx_dec__postfix(0));
    }

    function Unary_y_delete() internal {
        delete y;
    }

    function Unary_x_delete() internal {
        delete x;
    }

    function Unary_m_idx_delete(uint ARG0) internal {
        delete m[ARG0];
    }

    function Unary_x_idx_delete(uint256 ARG1) internal {
        delete x[ARG1];
    }

    function Unary_y_inc__postfix() internal returns (int256 RET0) {
        RET0 = y;
        y++;
    }

    function Unary_y_dec__prefix() internal returns (int256 RET1) {
        --y;
        RET1 = y;
    }

    function Unary_x_idx_inc__postfix(uint256 ARG2) internal returns (uint256 RET2) {
        RET2 = x[ARG2];
        x[ARG2]++;
    }

    function Unary_x_idx_dec__postfix(uint256 ARG3) internal returns (uint256 RET3) {
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
        SimpleAssignments_y_assign(1);
        assert(y == 1);
        x.push(1);
        SimpleAssignments_x_idx_assign(0, 2);
        assert(x[0] == 2);
        SimpleAssignments_y_assign(SimpleAssignments_x_idx_assign(0, 3));
        assert((y == 3) && (x[0] == 3));
        SimpleAssignments_y_plus_assign(SimpleAssignments_x_idx_minus_assign(0, 3));
        assert((y == 3) && (x[0] == 0));
        SimpleAssignments_x_idx_assign(SimpleAssignments_y_minus_assign(3), 1);
        assert((y == 0) && (x[0] == 1));
        SimpleAssignments_y_assign(plusOne(SimpleAssignments_x_idx_assign(y, 5)));
        assert((x[0] == 5) && (y == 6));
        for (SimpleAssignments_z_assign(0); z < y; SimpleAssignments_z_assign(z + 1)) {}
    }

    function SimpleAssignments_y_assign(uint ARG0) internal returns (uint256 RET0) {
        y = ARG0;
        RET0 = y;
    }

    function SimpleAssignments_x_idx_assign(uint256 ARG1, uint ARG2) internal returns (uint256 RET1) {
        x[ARG1] = ARG2;
        RET1 = x[ARG1];
    }

    function SimpleAssignments_y_plus_assign(uint ARG3) internal returns (uint256 RET2) {
        y += ARG3;
        RET2 = y;
    }

    function SimpleAssignments_x_idx_minus_assign(uint256 ARG4, uint ARG5) internal returns (uint256 RET3) {
        x[ARG4] -= ARG5;
        RET3 = x[ARG4];
    }

    function SimpleAssignments_y_minus_assign(uint ARG6) internal returns (uint256 RET4) {
        y -= ARG6;
        RET4 = y;
    }

    function SimpleAssignments_z_assign(uint ARG7) internal returns (uint256 RET5) {
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
    }

    uint internal x;
    uint internal y;

    function getTwo() internal pure returns (uint, uint) {
        return (3, 4);
    }

    function main() public {
        vars0 memory _v;
        (_v.tuple_tmp_1, _v.tuple_tmp_0) = (1, 2);
        TupleAssignments_y_assign(_v.tuple_tmp_0);
        TupleAssignments_x_assign(_v.tuple_tmp_1);
        assert((x == 1) && (y == 2));
        (_v.tuple_tmp_3, _v.tuple_tmp_2) = (y, x);
        TupleAssignments_y_assign(_v.tuple_tmp_2);
        TupleAssignments_x_assign(_v.tuple_tmp_3);
        assert((x == 2) && (y == 1));
        (_v.tuple_tmp_5, _v.tuple_tmp_4) = getTwo();
        TupleAssignments_y_assign(_v.tuple_tmp_4);
        TupleAssignments_x_assign(_v.tuple_tmp_5);
        assert((x == 3) && (y == 4));
        (_v.tuple_tmp_7, _v.tuple_tmp_6) = getTwo();
        TupleAssignments_x_assign(_v.tuple_tmp_6);
        TupleAssignments_x_assign(_v.tuple_tmp_7);
        assert((x == 3) && (y == 4));
        (_v.tuple_tmp_10, (_v.tuple_tmp_9, _v.tuple_tmp_8)) = (1, (2, 3));
        TupleAssignments_x_assign(_v.tuple_tmp_8);
        TupleAssignments_x_assign(_v.tuple_tmp_9);
        TupleAssignments_x_assign(_v.tuple_tmp_10);
        assert(x == 1);
        ((_v.tuple_tmp_13, _v.tuple_tmp_12), _v.tuple_tmp_11) = ((2, 3), 1);
        TupleAssignments_x_assign(_v.tuple_tmp_11);
        TupleAssignments_x_assign(_v.tuple_tmp_12);
        TupleAssignments_x_assign(_v.tuple_tmp_13);
        assert(x == 2);
    }

    function TupleAssignments_y_assign(uint ARG0) internal returns (uint256 RET0) {
        y = ARG0;
        RET0 = y;
    }

    function TupleAssignments_x_assign(uint ARG1) internal returns (uint256 RET1) {
        x = ARG1;
        RET1 = x;
    }
}`
        ]
    ];
    for (const [fileName, content, selector, expectedInstrumented] of goodSamples) {
        it(`Interpose on state vars in #${fileName}`, () => {
            const [sources, reader, files, compilerVersion] = toAst(fileName, content);
            const result = new XPath(sources[0]).query(selector);
            const nodes = result instanceof Array ? result : [result];
            const factory = new ASTNodeFactory(reader.context);
            const contract = sources[0].vContracts[0];
            const vars = new Set(contract.vStateVariables);

            const ctx = makeInstrumentationCtx(sources, factory, files, "log", compilerVersion);
            for (const node of nodes) {
                if (node instanceof Assignment && node.vLeftHandSide instanceof TupleExpression) {
                    const container = node.getClosestParentByType(
                        FunctionDefinition
                    ) as FunctionDefinition;
                    const transCtx = ctx.getTranspilingCtx(container);

                    interposeTupleAssignment(transCtx, node, vars);
                } else {
                    interposeSimpleStateVarUpdate(ctx, node);
                }
            }

            ctx.finalize();

            const instrumented = print(sources, [content], "0.6.0").get(sources[0]);
            expect(instrumented).toEqual(expectedInstrumented);
        });
    }
});
