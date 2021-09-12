pragma solidity 0.8.7;

/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}

/// #invariant sum < 200;
contract AssertMixed is __scribble_ReentrancyUtils {
    event AssertionFailed(string message);

    struct vars1 {
        bool __scribble_check_invs_at_end;
    }

    struct vars2 {
        uint256 i0;
        bool forall_0;
    }

    struct vars3 {
        uint256 old_0;
    }

    uint internal sum;

    function main(uint[] memory n) public {
        vars1 memory _v;
        _v.__scribble_check_invs_at_end = __scribble_out_of_contract;
        __scribble_out_of_contract = false;
        _original_AssertMixed_main(n);
        unchecked {
            if (!(n.length < 10)) {
                emit AssertionFailed("2: ");
                assert(false);
            }
        }
        if (_v.__scribble_check_invs_at_end) __scribble_check_state_invariants();
        __scribble_out_of_contract = _v.__scribble_check_invs_at_end;
    }

    function _original_AssertMixed_main(uint[] memory n) private {
        vars2 memory _v;
        unchecked {
            _v.forall_0 = true;
            for (_v.i0 = 0; _v.i0 < n.length; _v.i0++) {
                _v.forall_0 = n[_v.i0] <= 50;
                if (!_v.forall_0) break;
            }
            if (!(_v.forall_0)) {
                emit AssertionFailed("3: ");
                assert(false);
            }
        }
        for (uint i = 0; i < n.length; i++) {
            unchecked {
                if (!(n[i] > 2)) {
                    emit AssertionFailed("4: ");
                    assert(false);
                }
            }
            AssertMixed_sum_uint256_plus_assign(n[i]);
        }
    }

    /// Check only the current contract's state invariants
    function __scribble_AssertMixed_check_state_invariants_internal() internal {
        unchecked {
            if (!(sum < 200)) {
                emit AssertionFailed("0: ");
                assert(false);
            }
        }
    }

    /// Check the state invariant for the current contract and all its bases
    function __scribble_check_state_invariants() virtual internal {
        __scribble_AssertMixed_check_state_invariants_internal();
    }

    constructor() {
        __scribble_out_of_contract = false;
        __scribble_check_state_invariants();
        __scribble_out_of_contract = true;
    }

    function AssertMixed_sum_uint256_plus_assign(uint256 ARG0) internal returns (uint256 RET0) {
        vars3 memory _v;
        unchecked {
            _v.old_0 = sum;
        }
        sum += ARG0;
        RET0 = sum;
        unchecked {
            if (!((sum - _v.old_0) > 3)) {
                emit AssertionFailed("1: ");
                assert(false);
            }
        }
    }
}
