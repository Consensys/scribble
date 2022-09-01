/// This file is auto-generated by Scribble and shouldn't be edited directly.
/// Use --disarm prior to make any changes.
pragma solidity 0.8.16;

/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    event AssertionFailed(string message);

    event AssertionFailedData(int eventId, bytes encodingData);

    bool __scribble_out_of_contract = true;
}

contract RevertStmt is __scribble_ReentrancyUtils {
    error E();

    function foo() public {
        _original_RevertStmt_foo();
        unchecked {
            if (!(false)) {
                emit AssertionFailed("0: ");
                assert(false);
            }
        }
    }

    function _original_RevertStmt_foo() private {
        revert E();
    }
}
