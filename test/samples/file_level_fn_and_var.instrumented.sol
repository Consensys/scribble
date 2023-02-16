/// This file is auto-generated by Scribble and shouldn't be edited directly.
/// Use --disarm prior to make any changes.
pragma solidity 0.7.5;

uint constant SOME = 10;

function addSome(uint v) pure returns (uint) {
    return v + SOME;
}

contract Test {
    uint internal num;

    function operate() public {
        _original_Test_operate();
        if (!(num == 25)) {
            __ScribbleUtilsLib__31.assertionFailed("0: P1");
            assert(false);
        }
    }

    function _original_Test_operate() private {
        num = addSome(15);
    }
}

library __ScribbleUtilsLib__31 {
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
