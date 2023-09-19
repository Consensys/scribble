pragma solidity 0.6.10;

/// #invariant {:msg ""} x>0;
contract PosConstructorFail {
    int x = 0;
    function inc() public {
        x++;
    }
}

// ---------------------------------------------

/// #invariant {:msg ""} x>0;
contract PosExtCallFail {
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

// ---------------------------------------------

interface IPosLibInterface {
    function boo() external;
}

library SillyMath {
    function add(int a, int b) public returns (int) {
        return a+b;
    }
}

/// #invariant {:msg ""} x>0;
contract PosLibInterface is IPosLibInterface {
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
