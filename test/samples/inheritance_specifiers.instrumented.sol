pragma solidity 0.8.7;

/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}

contract A is __scribble_ReentrancyUtils {
    uint public a;

    constructor(uint _a) {
        __scribble_out_of_contract = false;
        require(_a >= 0);
        a = _a;
        __scribble_check_state_invariants();
        __scribble_out_of_contract = true;
    }

    /// Check only the current contract's state invariants
    function __scribble_A_check_state_invariants_internal() internal {}

    /// Check the state invariant for the current contract and all its bases
    function __scribble_check_state_invariants() virtual internal {
        __scribble_A_check_state_invariants_internal();
    }
}

/// #invariant a > 0;
contract B is __scribble_ReentrancyUtils, A {
    event AssertionFailed(string message);

    constructor() A(1) {
        __scribble_out_of_contract = false;
        __scribble_check_state_invariants();
        __scribble_out_of_contract = true;
    }

    /// Check only the current contract's state invariants
    function __scribble_B_check_state_invariants_internal() internal {
        unchecked {
            if (!(a > 0)) {
                emit AssertionFailed("0: ");
                assert(false);
            }
        }
    }

    /// Check the state invariant for the current contract and all its bases
    function __scribble_check_state_invariants() virtual override internal {
        __scribble_B_check_state_invariants_internal();
        __scribble_A_check_state_invariants_internal();
    }
}
