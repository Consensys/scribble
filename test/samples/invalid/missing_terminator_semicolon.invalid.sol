pragma solidity ^0.5.0;
contract Test {
    /// Leading string
    ///
    /// #if_succeeds {:msg "P0"} y > x;
    ///
    /// #if_succeeds {:msg "P1"}
    ///    y == x+2;
    ///
    /// #if_succeeds {:msg "P2"} y == x+3
    ///
    /// Trailing string
    function foo(uint256 x) public returns (uint256 y) {
        return x + 1;
    }
}
