pragma solidity ^0.5.0;

contract Base {
    /// #if_succeeds {:msg "P0"} y > x;
    function foo(uint256 x) public returns (uint256 y) {
        return x+2;
    }
}

contract Foo is Base {
    /// #if_succeeds {:msg "P0"} y == x+1;
    function foo(uint256 x) public returns (uint256 y) {
        return x + 1;
    }
}
