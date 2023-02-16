/// This file is auto-generated by Scribble and shouldn't be edited directly.
/// Use --disarm prior to make any changes.
pragma solidity 0.8.7;

/// #define id(uint x) uint = x + 1 - 1;
contract TestUnchecked {
    uint8 internal x = 100;

    function foo() public {
        _original_TestUnchecked_foo();
        unchecked {
            if (!(x == 1)) {
                __ScribbleUtilsLib__25.assertionFailed("3: S1");
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
                __ScribbleUtilsLib__25.assertionFailed("1: A1");
                assert(false);
            }
            if (!(x > 0)) {
                __ScribbleUtilsLib__25.assertionFailed("2: U1");
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
                __ScribbleUtilsLib__25.assertionFailed("1: A1");
                assert(false);
            }
            if (!(x > 0)) {
                __ScribbleUtilsLib__25.assertionFailed("2: U1");
                assert(false);
            }
        }
    }

    function TestUnchecked_x_uint8_plus_assign(uint8 ARG1) internal returns (uint8 RET1) {
        x += ARG1;
        RET1 = x;
        unchecked {
            if (!(id(x) > 0)) {
                __ScribbleUtilsLib__25.assertionFailed("1: A1");
                assert(false);
            }
            if (!(x > 0)) {
                __ScribbleUtilsLib__25.assertionFailed("2: U1");
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
                __ScribbleUtilsLib__25.assertionFailed("1: A1");
                assert(false);
            }
            if (!(x > 0)) {
                __ScribbleUtilsLib__25.assertionFailed("2: U1");
                assert(false);
            }
        }
    }
}

library __ScribbleUtilsLib__25 {
    event AssertionFailed(string message);

    event AssertionFailedData(int eventId, bytes encodingData);

    function assertionFailed(string memory arg_0) internal {
        emit AssertionFailed(arg_0);
    }

    function assertionFailedData(int arg_0, bytes memory arg_1) internal {
        emit AssertionFailedData(arg_0, arg_1);
    }
}

/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    event AssertionFailed(string message);

    event AssertionFailedData(int eventId, bytes encodingData);

    bool __scribble_out_of_contract = true;
}
