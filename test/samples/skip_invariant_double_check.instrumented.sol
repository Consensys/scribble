/// This file is auto-generated by Scribble and shouldn't be edited directly.
/// Use --disarm prior to make any changes.
pragma solidity 0.8.15;

/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    event AssertionFailed(string message);

    event AssertionFailedData(int eventId, bytes encodingData);

    bool __scribble_out_of_contract = true;
}

/// #invariant true;
contract Foo is __scribble_ReentrancyUtils {
    struct vars1 {
        bool __scribble_check_invs_at_end;
    }

    constructor(uint x) {
        vars1 memory _v;
        _v.__scribble_check_invs_at_end = __scribble_out_of_contract;
        __scribble_out_of_contract = false;
        _original_Foo_constructor(x);
        unchecked {
            if (!(false)) {
                emit AssertionFailed("1: ");
                assert(false);
            }
        }
        if (_v.__scribble_check_invs_at_end) __scribble_check_state_invariants();
        __scribble_out_of_contract = _v.__scribble_check_invs_at_end;
    }

    function _original_Foo_constructor(uint x) private {}

    /// Check only the current contract's state invariants
    function __scribble_Foo_check_state_invariants_internal() internal {
        unchecked {
            if (!(true)) {
                emit AssertionFailed("0: ");
                assert(false);
            }
        }
    }

    /// Check the state invariant for the current contract and all its bases
    function __scribble_check_state_invariants() virtual internal {
        __scribble_Foo_check_state_invariants_internal();
    }
}
