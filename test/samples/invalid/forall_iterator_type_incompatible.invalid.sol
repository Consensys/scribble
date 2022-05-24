pragma solidity 0.8.12;

contract Foo {
    /// #if_succeeds forall(bytes32 x in hashes) x != bytes32(0x0);
    function foo(bytes32[] memory hashes) public {}
}
