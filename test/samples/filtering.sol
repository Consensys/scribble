pragma solidity 0.6.10;

/// invariant {:msg "Low.P0"} x > 0;
/// invariant {:msg "Medium.P1"} x == 0;
/// invariant {:msg "Critical.P2"} x < 0;
contract Foo {
    uint x;

    constructor (uint _x) public {
        x = _x;
    }

    /// if_succeeds {:msg "Critical.P4"} b == a + 1;
    function foo(uint256 a) public returns (uint256 b) {
        return a + 1;
    }
}
