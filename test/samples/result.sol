pragma solidity 0.7.5;

contract Foo {
    /// if_succeeds {:msg ""} $result == 1;
    function a() public returns (uint) {
        return 1;
    }

    /// if_succeeds {:msg ""} $result == x;
    /// if_succeeds {:msg ""} let t := $result in t == x;
    function b() public returns (uint x) {
        x = 2;
    }

    /// if_succeeds {:msg ""} let a,b := $result in a == 1 && b == 2 && t == b;
    function d() public returns (uint, uint t) {
        return (1,2);
    }
}