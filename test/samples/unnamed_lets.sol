pragma solidity 0.6.10;
contract Foo {
    function snd(uint v) internal pure returns (uint, uint) {
        return (1,v);
    }

    /// #if_succeeds {:msg "P0"} let _,x := snd(v) in x == 2;
    function foo(uint v) public {
    }
}
