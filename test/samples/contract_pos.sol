pragma solidity 0.6.10;
/// #invariant {:msg ""} x>0;
contract Foo {
    int x = 1;
    function inc() public {
        x++;
    }

    function add(int v) internal {
        x+=v;
    }

    function fail() public {
        add(0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff);
    }
}
