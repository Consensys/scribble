pragma solidity 0.6.10;

abstract contract Base {
    /// if_succeeds {:msg "P0"} y == x+1;
    function foo(uint256 x) public virtual returns (uint256 y);
}

contract Foo is Base {
    function foo(uint256 x) public override returns (uint256 y) {
        return x + 1;
    }
}