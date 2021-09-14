pragma solidity 0.7.5;

uint constant SOME = 10;

function addSome(uint v) pure returns (uint) {
    return v + SOME;
}

contract Test {
    event AssertionFailed(string message);

    uint internal num;

    function operate() public {
        _original_Test_operate();
        if (!(num == 25)) {
            emit AssertionFailed("0: P1");
            assert(false);
        }
    }

    function _original_Test_operate() private {
        num = addSome(15);
    }
}

/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}
