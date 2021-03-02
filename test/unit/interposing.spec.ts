import {
    ASTContext,
    ASTNodeFactory,
    ContractDefinition,
    FunctionCall,
    FunctionDefinition,
    SourceUnit
} from "solc-typed-ast";
import expect from "expect";
import { print as printUnits, rewriteImports } from "../../src/ast_to_source_printer";
import {
    ContractInstrumenter,
    findExternalCalls,
    generateUtilsContract,
    interpose,
    interposeCall
} from "../../src/instrumenter";
import { cook } from "../../src/rewriter";
import { single } from "../../src/util";
import { findContract, findFunction, toAst } from "../integration/utils";
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
        "flat"
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
            const contract: ContractDefinition = findContract(contractName, sources);
            const fun: FunctionDefinition = findFunction(funName, contract);
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
    struct vars0 {
        uint256 __mstore_scratch__;
    }

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
    function __scribble_Foo_check_state_invariants_internal() internal view {
        vars0 memory _v;
    }

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

            const contract = findContract(contractName, sources);
            const factory = new ASTNodeFactory(reader.context);
            const contractInstrumenter = new ContractInstrumenter();

            const ctx = makeInstrumentationCtx(
                sources,
                factory,
                files,
                assertionMode,
                compilerVersion
            );
            contractInstrumenter.instrument(ctx, new TypeEnv(), new Map(), [], contract, true);

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
            const contract: ContractDefinition = findContract(contractName, sources);
            const fun: FunctionDefinition = findFunction(funName, contract);
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

            const instrumented = print(sources, [content], "0.6.0").get(sources[0]) as string;

            // Check that the interposed code compiles correctly
            expect(toAst.bind(toAst, "foo.sol", instrumented)).not.toThrow();
            // Check that it equals the expected code
            expect(instrumented).toEqual(expectedInstrumented);
        });
    }
});
