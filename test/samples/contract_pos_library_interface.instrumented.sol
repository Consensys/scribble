pragma solidity 0.6.10;

interface IFoo {
    function boo() external;
}

library SillyMath {
    function add(int a, int b) public returns (int) {
        return a + b;
    }
}

/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}

/// #invariant {:msg ""} x>0;
contract Foo is __scribble_ReentrancyUtils, IFoo {
    using SillyMath for int;

    event AssertionFailed(string message);

    struct vars2 {
        bool __scribble_check_invs_at_end;
    }

    struct vars3 {
        bool __scribble_check_invs_at_end;
    }

    int internal x = 1;

    function boo() override external {
        __scribble_out_of_contract = false;
        _original_Foo_boo();
        __scribble_check_state_invariants();
        __scribble_out_of_contract = true;
    }

    function _original_Foo_boo() private {}

    function inc() public {
        vars2 memory _v;
        _v.__scribble_check_invs_at_end = __scribble_out_of_contract;
        __scribble_out_of_contract = false;
        _original_Foo_inc();
        if (_v.__scribble_check_invs_at_end) __scribble_check_state_invariants();
        __scribble_out_of_contract = _v.__scribble_check_invs_at_end;
    }

    function _original_Foo_inc() private {
        x++;
    }

    function add(int v) internal {
        x = x.add(v);
    }

    function fail() public {
        vars3 memory _v;
        _v.__scribble_check_invs_at_end = __scribble_out_of_contract;
        __scribble_out_of_contract = false;
        _original_Foo_fail();
        if (_v.__scribble_check_invs_at_end) __scribble_check_state_invariants();
        __scribble_out_of_contract = _v.__scribble_check_invs_at_end;
    }

    function _original_Foo_fail() private {
        add(0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff);
    }

    /// Check only the current contract's state invariants
    function __scribble_Foo_check_state_invariants_internal() internal {
        if (!(x > 0)) {
            emit AssertionFailed("0: ");
            assert(false);
        }
    }

    /// Check the state invariant for the current contract and all its bases
    function __scribble_check_state_invariants() virtual internal {
        __scribble_Foo_check_state_invariants_internal();
    }

    constructor() public {
        __scribble_out_of_contract = false;
        __scribble_check_state_invariants();
        __scribble_out_of_contract = true;
    }
}
