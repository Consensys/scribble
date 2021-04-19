pragma solidity 0.8.3;

/// define id(uint x) uint = x + 1 - 1;
contract TestUnchecked {
    event AssertionFailed(string message);

    uint8 internal x = 100;

    function foo() public {
        _original_TestUnchecked_foo();
        unchecked {
            if (!(x == 1)) {
                emit AssertionFailed("3: S1");
                assert(false);
            }
        }
    }

    function _original_TestUnchecked_foo() private {
        TestUnchecked_x_uint8_assign(254);
        TestUnchecked_x_uint8_plus_assign(1);
        unchecked {
            TestUnchecked_x_uint8_plus_assign_unchecked(2);
        }
    }

    /// Implementation of user function define id(uint256 x) uint256 = ((x + 1) - 1)
    function id(uint256 x1) internal view returns (uint256) {
        unchecked {
            return (x1 + 1) - 1;
        }
    }

    function TestUnchecked_x_inline_initializer() internal {
        unchecked {
            if (!(id(x) > 0)) {
                emit AssertionFailed("1: A1");
                assert(false);
            }
            if (!(x > 0)) {
                emit AssertionFailed("2: U1");
                assert(false);
            }
        }
    }

    constructor() {
        TestUnchecked_x_inline_initializer();
    }

    function TestUnchecked_x_uint8_assign(uint8 ARG0) internal returns (uint8 RET0) {
        x = ARG0;
        RET0 = x;
        unchecked {
            if (!(id(x) > 0)) {
                emit AssertionFailed("1: A1");
                assert(false);
            }
            if (!(x > 0)) {
                emit AssertionFailed("2: U1");
                assert(false);
            }
        }
    }

    function TestUnchecked_x_uint8_plus_assign(uint8 ARG1) internal returns (uint8 RET1) {
        x += ARG1;
        RET1 = x;
        unchecked {
            if (!(id(x) > 0)) {
                emit AssertionFailed("1: A1");
                assert(false);
            }
            if (!(x > 0)) {
                emit AssertionFailed("2: U1");
                assert(false);
            }
        }
    }

    function TestUnchecked_x_uint8_plus_assign_unchecked(uint8 ARG2) internal returns (uint8 RET2) {
        unchecked {
            x += ARG2;
        }
        RET2 = x;
        unchecked {
            if (!(id(x) > 0)) {
                emit AssertionFailed("1: A1");
                assert(false);
            }
            if (!(x > 0)) {
                emit AssertionFailed("2: U1");
                assert(false);
            }
        }
    }
}
/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}
