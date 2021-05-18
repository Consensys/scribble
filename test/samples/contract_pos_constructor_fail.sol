pragma solidity 0.6.10;
/// #invariant {:msg ""} x>0;
contract Foo {
    int x = 0;
    function inc() public {
        x++;
    }
}
