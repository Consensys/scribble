pragma solidity 0.8.4;

contract Foo {
    // Simple map
    uint[] a = [10];
    int8[] b;

    /// @custom:scribble #if_succeeds unchecked_sum(a) > 10 && unchecked_sum(a) < 20
    /// dijfhs
    function pushA(uint k) public {
        a.push(k);
    }

}
