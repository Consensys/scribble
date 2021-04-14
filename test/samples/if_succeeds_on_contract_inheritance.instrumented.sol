pragma solidity 0.7.0;

/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}
/// if_succeeds {:msg ""} b == a + 1; 
///  if_succeeds {:msg ""} b == a&1; 
contract Foo is __scribble_ReentrancyUtils {
    event AssertionFailed(string message);

    struct vars1 {
        bool __scribble_check_invs_at_end;
    }

    uint internal a;
    uint internal b;

    function inc(uint x) public returns (uint y) {
        vars1 memory _v;
        _v.__scribble_check_invs_at_end = __scribble_out_of_contract;
        __scribble_out_of_contract = false;
        y = _original_Foo_inc(x);
        if (!(b == (a ^ 1))) {
            emit AssertionFailed("2: ");
            assert(false);
        }
        if (_v.__scribble_check_invs_at_end) __scribble_check_state_invariants();
        __scribble_out_of_contract = _v.__scribble_check_invs_at_end;
    }

    function _original_Foo_inc(uint x) private pure returns (uint y) {
        return x + 1;
    }

    /// Check only the current contract's state invariants
    function __scribble_Foo_check_state_invariants_internal() internal {
        if (!(b == (a + 1))) {
            emit AssertionFailed("0: ");
            assert(false);
        }
        if (!(b == (a & 1))) {
            emit AssertionFailed("1: ");
            assert(false);
        }
    }

    /// Check the state invariant for the current contract and all its bases
    function __scribble_check_state_invariants() virtual internal {
        __scribble_Foo_check_state_invariants_internal();
    }

    constructor() {
        __scribble_out_of_contract = false;
        __scribble_check_state_invariants();
        __scribble_out_of_contract = true;
    }
}

contract Bar is __scribble_ReentrancyUtils, Foo {
    function inc2(uint x) public pure returns (uint y) {
        return x + 2;
    }

    /// Check only the current contract's state invariants
    function __scribble_Bar_check_state_invariants_internal() internal {}

    /// Check the state invariant for the current contract and all its bases
    function __scribble_check_state_invariants() virtual override internal {
        __scribble_Bar_check_state_invariants_internal();
        __scribble_Foo_check_state_invariants_internal();
    }

    constructor() {
        __scribble_out_of_contract = false;
        __scribble_check_state_invariants();
        __scribble_out_of_contract = true;
    }
}
