pragma solidity 0.6.10;

contract Base {
    event AssertionFailed(string message);

    function foo(uint256 x) virtual public returns (uint256 y) {
        y = _original_Base_foo(x);
        if (!(y > x)) {
            emit AssertionFailed("0: P0");
            assert(false);
        }
    }

    function _original_Base_foo(uint256 x) private returns (uint256 y) {
        return x + 2;
    }
}

contract Foo is Base {
    function foo(uint256 x) override public returns (uint256 y) {
        y = _original_Foo_foo(x);
        if (!(y > x)) {
            emit AssertionFailed("0: P0");
            assert(false);
        }
        if (!(y == (x + 1))) {
            emit AssertionFailed("1: P0");
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
