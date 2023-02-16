/// This file is auto-generated by Scribble and shouldn't be edited directly.
/// Use --disarm prior to make any changes.
pragma solidity 0.8.15;

interface Bar {
    function bar() external;
}

library __ScribbleUtilsLib__49 {
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

/// #invariant true;
contract Foo is __scribble_ReentrancyUtils {
    function main(bool flag, Bar b) internal {
        if (flag) {
            __scribble_check_state_invariants();
            __scribble_out_of_contract = true;
            try b.bar() {
                __scribble_out_of_contract = false;
            } catch Error(string memory reason) {
                __scribble_out_of_contract = false;
                revert(reason);
            } catch Panic(uint code) {
                __scribble_out_of_contract = false;
                revert("panic");
            } catch {
                __scribble_out_of_contract = false;
                revert("foo");
            }
        }
    }

    /// Check only the current contract's state invariants
    function __scribble_Foo_check_state_invariants_internal() internal {
        unchecked {
            if (!(true)) {
                __ScribbleUtilsLib__49.assertionFailed("0: ");
                assert(false);
            }
        }
    }

    /// Check the state invariant for the current contract and all its bases
    function __scribble_check_state_invariants() virtual internal {
        __scribble_Foo_check_state_invariants_internal();
    }

    constructor() {
        __scribble_out_of_contract = false;
        __scribble_check_state_invariants();
        __scribble_out_of_contract = true;
    }
}
