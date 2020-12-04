pragma solidity 0.6.10;

interface IFoo {
    function boo() external;
}

library SillyMath {
    function add(int a, int b) public returns (int) {
        return a+b;
    }
}

/// invariant {:msg ""} x>0;
contract Foo is IFoo{
    using SillyMath for int;

    function boo() override external {}

    int x = 1;
    function inc() public {
        x++;
    }

    function add(int v) internal {
        x = x.add(v);
    }

    function fail() public {
        add(0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff);
    }
}
