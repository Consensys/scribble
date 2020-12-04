pragma solidity 0.6.12;
contract Foo {
    uint t;
    /// if_succeeds {:msg ""} let oldTT := old(t) in let oldT := oldTT in let oldTTimes2 := old(oldT * 2) in oldTTimes2 == t;
    function moo() public  {
        t = t *2;
    }
}
