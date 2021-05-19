pragma solidity 0.6.10;
contract Foo {
    /// #if_succeeds {:msg "P0"} keccak256("ab;") != bytes32(0x0);
    ///
    /// #if_succeeds {:msg "P1"} y == x + 1;
    function foo(uint256 x) public returns (uint256 y) {
        return x + 1;
    }
}
