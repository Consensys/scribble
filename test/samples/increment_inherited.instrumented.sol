/// This file is auto-generated by Scribble and shouldn't be edited directly.
/// Use --disarm prior to make any changes.
pragma solidity 0.5.17;

contract Base {
    /// #if_succeeds {:msg "P0"} y == x+1;
    function foo(uint256 x) public returns (uint256 y);
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

contract Foo is Base {
    function foo(uint256 x) public returns (uint256 y) {
        y = _original_Foo_foo(x);
        if (!(y == (x + 1))) {
            __ScribbleUtilsLib__25.assertionFailed("0: P0");
            assert(false);
        }
    }

    function _original_Foo_foo(uint256 x) private returns (uint256 y) {
        return x + 1;
    }
}
