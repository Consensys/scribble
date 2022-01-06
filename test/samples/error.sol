pragma solidity 0.8.7;

contract Foo {
    error E();
    /// #if_succeeds true;
    function foo() public {}
}
