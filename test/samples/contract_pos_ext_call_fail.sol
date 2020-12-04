pragma solidity 0.6.10;
/// invariant {:msg ""} x>0;
contract Foo {
    int x = 1;
    function inc() public {
        x++;
    }

    function fail_int() internal {
        x = 0;
        // Should detect failure here
        this.inc();
        // At this point x>0
    }

    function fail() public {
        fail_int();
    }
}
