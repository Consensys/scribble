import expect from "expect";
import { scribble } from "../../utils";

const cases: Array<[string, string, string, string]> = [
    [
        "test/samples/filtering.sol",
        "--filter-type",
        "if_succeeds",
        `
pragma solidity 0.6.10;

/// #invariant {:msg "Low.P0"} x > 0;
///  #invariant {:msg "Medium.P1"} x == 0;
///  #invariant {:msg "Critical.P2"} x < 0;
contract Foo {
    uint internal x;

    constructor(uint _x) public {
        x = _x;
    }

    function foo(uint256 a) public returns (uint256 b) {
        b = _original_Foo_foo(a);
        if (!(b == (a + 1))) {
            emit __ScribbleUtilsLib__29.AssertionFailed("000500:0077:000 3: Critical.P4");
            assert(false);
        }
    }

    function _original_Foo_foo(uint256 a) internal returns (uint256 b) {
        return a + 1;
    }
}

library __ScribbleUtilsLib__29 {
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
}
        `
    ],
    [
        "test/samples/filtering.sol",
        "--filter-message",
        "P1",
        `
contract Foo {
    struct vars1 {
        bool __scribble_check_invs_at_end;
    }

    uint internal x;

    constructor(uint _x) public {
        __ScribbleUtilsLib__29.setInContract(true);
        x = _x;
        __scribble_check_state_invariants();
        __ScribbleUtilsLib__29.setInContract(false);
    }

    function foo(uint256 a) public returns (uint256 b) {
        vars1 memory _v;
        _v.__scribble_check_invs_at_end = !__ScribbleUtilsLib__29.isInContract();
        __ScribbleUtilsLib__29.setInContract(true);
        b = _original_Foo_foo(a);
        if (_v.__scribble_check_invs_at_end) __scribble_check_state_invariants();
        __ScribbleUtilsLib__29.setInContract(!_v.__scribble_check_invs_at_end);
    }

    function _original_Foo_foo(uint256 a) internal returns (uint256 b) {
        return a + 1;
    }

    /// Check only the current contract's state invariants
    function __scribble_Foo_check_state_invariants_internal() internal {
        if (!(x == 0)) {
            emit __ScribbleUtilsLib__29.AssertionFailed("001275:0075:000 1: Medium.P1");
            assert(false);
        }
    }

    /// Check the state invariant for the current contract and all its bases
    function __scribble_check_state_invariants() virtual internal {
        __scribble_Foo_check_state_invariants_internal();
    }
}`
    ],
    [
        "test/samples/filtering.sol",
        "--filter-message",
        "Critical\\..+",
        `
contract Foo {
    struct vars1 {
        bool __scribble_check_invs_at_end;
    }

    uint internal x;

    constructor(uint _x) public {
        __ScribbleUtilsLib__29.setInContract(true);
        x = _x;
        __scribble_check_state_invariants();
        __ScribbleUtilsLib__29.setInContract(false);
    }

    function foo(uint256 a) public returns (uint256 b) {
        vars1 memory _v;
        _v.__scribble_check_invs_at_end = !__ScribbleUtilsLib__29.isInContract();
        __ScribbleUtilsLib__29.setInContract(true);
        b = _original_Foo_foo(a);
        if (!(b == (a + 1))) {
            emit __ScribbleUtilsLib__29.AssertionFailed("000878:0077:000 3: Critical.P4");
            assert(false);
        }
        if (_v.__scribble_check_invs_at_end) __scribble_check_state_invariants();
        __ScribbleUtilsLib__29.setInContract(!_v.__scribble_check_invs_at_end);
    }

    function _original_Foo_foo(uint256 a) internal returns (uint256 b) {
        return a + 1;
    }

    /// Check only the current contract's state invariants
    function __scribble_Foo_check_state_invariants_internal() internal {
        if (!(x < 0)) {
            emit __ScribbleUtilsLib__29.AssertionFailed("001433:0077:000 2: Critical.P2");
            assert(false);
        }
    }

    /// Check the state invariant for the current contract and all its bases
    function __scribble_check_state_invariants() virtual internal {
        __scribble_Foo_check_state_invariants_internal();
    }
}`
    ]
];

for (const [fileName, option, value, fragment] of cases) {
    describe(`scribble ${fileName} ${option} '${value}'`, () => {
        let outData: string;

        before(() => {
            outData = scribble(fileName, option, value);
        });

        it("STDOUT is correct", () => {
            expect(outData).toContain(fragment.trim());
        });
    });
}
