/// This file is auto-generated by Scribble and shouldn't be edited directly.
/// Use --disarm prior to make any changes.
pragma solidity 0.8.7;

contract Foo {
    error E();

    function foo() public {
        _original_Foo_foo();
        unchecked {
            if (!(true)) {
                __ScribbleUtilsLib__10.assertionFailed("0: ");
                assert(false);
            }
        }
    }

    function _original_Foo_foo() private {}
}

library __ScribbleUtilsLib__10 {
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
