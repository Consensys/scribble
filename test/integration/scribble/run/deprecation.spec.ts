import { spawnSync } from "child_process";
import expect from "expect";

describe(`Command "scribble <filename>" emits deprecation warning`, () => {
    const cases: Array<[string, string, string]> = [
        [
            "test/samples/unprefixed.sol",
            `
---------------------------------------------
[notice] Annotations without "#" prefix are deprecated:

test/samples/unprefixed.sol:3:3 define should be #define
test/samples/unprefixed.sol:5:3 invariant should be #invariant
test/samples/unprefixed.sol:9:8 if_succeeds should be #if_succeeds
test/samples/unprefixed.sol:14:8 if_succeeds should be #if_succeeds
---------------------------------------------      
        `,
            `
pragma solidity 0.6.10;

/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}

///  define some(uint a) uint = 1 + a;
///  invariant
///       some(1) != 2;
contract Foo is __scribble_ReentrancyUtils {
    event AssertionFailed(string message);

    struct vars2 {
        bool __scribble_check_invs_at_end;
    }

    function foo(uint256 x) public returns (uint256 y) {
        vars2 memory _v;
        _v.__scribble_check_invs_at_end = __scribble_out_of_contract;
        __scribble_out_of_contract = false;
        y = _original_Foo_foo(x);
        if (!(1 == 1)) {
            emit AssertionFailed("2: P0");
            assert(false);
        }
        if (!(y == (x + 1))) {
            emit AssertionFailed("3: P1");
            assert(false);
        }
        if (_v.__scribble_check_invs_at_end) __scribble_check_state_invariants();
        __scribble_out_of_contract = _v.__scribble_check_invs_at_end;
    }

    function _original_Foo_foo(uint256 x) private returns (uint256 y) {
        return x + 1;
    }

    /// Implementation of user function define some(uint256 a) uint256 = (1 + a)
    function some(uint256 a) internal view returns (uint256) {
        return 1 + a;
    }

    /// Check only the current contract's state invariants
    function __scribble_Foo_check_state_invariants_internal() internal {
        if (!(some(1) != 2)) {
            emit AssertionFailed("1: ");
            assert(false);
        }
    }

    /// Check the state invariant for the current contract and all its bases
    function __scribble_check_state_invariants() virtual internal {
        __scribble_Foo_check_state_invariants_internal();
    }

    constructor() public {
        __scribble_out_of_contract = false;
        __scribble_check_state_invariants();
        __scribble_out_of_contract = true;
    }
}
        `
        ]
    ];

    for (const [fileName, notice, instrumentation] of cases) {
        describe(`scribble ${fileName}`, () => {
            let outData: string;
            let errData: string;

            before(() => {
                const result = spawnSync("scribble", [fileName], { encoding: "utf8" });

                outData = result.stdout;
                errData = result.stderr;
            });

            it("STDERR is correct", () => {
                expect(errData).toContain(notice.trim());
            });

            it("STDOUT is correct", () => {
                expect(outData).toContain(instrumentation.trim());
            });
        });
    }
});
