pragma solidity ^0.5.0;

contract Base {
    function foo(uint256 x) public returns (uint256 y) {
        return x+2;
    }
}

contract Foo is Base {
    /// #if_succeeds {:msg "P0"} x>10;
    function foo(uint256 x) public returns (uint256 y) {
        return x + 1;
    }
}

contract Test {
    function main() public {
        Foo f = new Foo();
        Base b = Base(f);

        b.foo(0); // This should still fail.
    }
}