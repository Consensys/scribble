pragma solidity 0.5.17;

contract Base {
    function foo(uint256 x) public returns (uint256 y) {
        return x + 2;
    }
}

contract Foo is Base {
    event AssertionFailed(string message);

    function foo(uint256 x) public returns (uint256 y) {
        y = _original_Foo_foo(x);
        if (!(x > 10)) {
            emit AssertionFailed("0: P0");
            assert(false);
        }
    }

    function _original_Foo_foo(uint256 x) private returns (uint256 y) {
        return x + 1;
    }
}

contract Test {
    function main() public {
        Foo f = new Foo();
        Base b = Base(f);
        b.foo(0);
    }
}
/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}
