pragma solidity 0.5.17;

contract Base {
    /// if_succeeds {:msg "P0"} y == x+1;
    function foo(uint256 x) public returns (uint256 y);
}

contract Foo is Base {
    event AssertionFailed(string message);

    function foo(uint256 x) public returns (uint256 y) {
        y = _original_Foo_foo(x);
        if (!(y == (x + 1))) {
            emit AssertionFailed("0: P0");
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
