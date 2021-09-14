pragma solidity 0.6.10;

contract Foo {
    event AssertionFailed(string message);

    function foo(uint256 x) public returns (uint256 y) {
        y = _original_Foo_foo(x);
        if (!(keccak256("ab;") != bytes32(0x0))) {
            emit AssertionFailed("0: P0");
            assert(false);
        }
        if (!(y == (x + 1))) {
            emit AssertionFailed("1: P1");
            assert(false);
        }
    }

    function _original_Foo_foo(uint256 x) private returns (uint256 y) {
        return x + 1;
    }
}

/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}
