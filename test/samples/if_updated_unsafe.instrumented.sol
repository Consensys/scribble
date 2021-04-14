pragma solidity 0.8.3;

contract TestUnchecked {
    event AssertionFailed(string message);

    uint8 internal x = 100;

    function foo() public {
        _original_TestUnchecked_foo();
        unchecked {
            if (!(x == 1)) {
                emit AssertionFailed("2: S1");
                assert(false);
            }
        }
    }

    function _original_TestUnchecked_foo() private {
        TestUnchecked_x_uint8_assign(255);
        unchecked {
            TestUnchecked_x_uint8_plus_assign(2);
        }
    }

    function TestUnchecked_x_inline_initializer() internal {
        unchecked {
            if (!(x > 0)) {
                emit AssertionFailed("0: A1");
                assert(false);
            }
            if (!(x > 0)) {
                emit AssertionFailed("1: U1");
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
            if (!(x > 0)) {
                emit AssertionFailed("0: A1");
                assert(false);
            }
            if (!(x > 0)) {
                emit AssertionFailed("1: U1");
                assert(false);
            }
        }
    }

    function TestUnchecked_x_uint8_plus_assign(uint8 ARG1) internal returns (uint8 RET1) {
        unchecked {
            x += ARG1;
        }
        RET1 = x;
        unchecked {
            if (!(x > 0)) {
                emit AssertionFailed("0: A1");
                assert(false);
            }
            if (!(x > 0)) {
                emit AssertionFailed("1: U1");
                assert(false);
            }
        }
    }
}
/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}
