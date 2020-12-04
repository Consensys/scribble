pragma solidity 0.6.10;

contract Foo {
    event AssertionFailed(string message);

    uint internal x = 1;

    function getX() public returns (uint RET_0) {
        RET_0 = _original_Foo_getX();
        if ((!((x > 0)))) {
            emit AssertionFailed("0: ");
            assert(false);
        }
    }

    function _original_Foo_getX() private view returns (uint) {
        return x;
    }

    function getXPlus1() public returns (uint) {
        return (getX() + 1);
    }
}
/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}
