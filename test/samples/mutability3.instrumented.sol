/// This file is auto-generated by Scribble and shouldn't be edited directly.
/// Use --disarm prior to make any changes.
pragma solidity 0.6.10;

contract Base {
    function getX() virtual public returns (uint) {
        return 1;
    }
}

library __ScribbleUtilsLib__41 {
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
    uint internal x = 1;

    function getX() virtual override public returns (uint RET_0) {
        RET_0 = _original_Foo_getX();
        if (!(x > 0)) {
            __ScribbleUtilsLib__41.assertionFailed("0: ");
            assert(false);
        }
    }

    function _original_Foo_getX() private view returns (uint) {
        return x;
    }
}

contract Child is Foo {
    function getX() virtual override public returns (uint RET_0) {
        RET_0 = _original_Child_getX();
        if (!(x > 0)) {
            __ScribbleUtilsLib__41.assertionFailed("0: ");
            assert(false);
        }
    }

    function _original_Child_getX() private returns (uint) {
        return x + 1;
    }
}
