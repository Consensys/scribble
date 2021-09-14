pragma solidity 0.6.8;

/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}

/// #invariant {:msg "P1"} true;
contract Test is __scribble_ReentrancyUtils {
    event AssertionFailed(string message);

    function foo(bytes calldata x) external returns (uint RET_0) {
        __scribble_out_of_contract = false;
        RET_0 = _original_Test_foo(x);
        __scribble_check_state_invariants();
        __scribble_out_of_contract = true;
    }

    function _original_Test_foo(bytes memory x) private returns (uint) {
        return x.length;
    }

    /// Check only the current contract's state invariants
    function __scribble_Test_check_state_invariants_internal() internal {
        if (!(true)) {
            emit AssertionFailed("0: P1");
            assert(false);
        }
    }

    /// Check the state invariant for the current contract and all its bases
    function __scribble_check_state_invariants() virtual internal {
        __scribble_Test_check_state_invariants_internal();
    }

    constructor() public {
        __scribble_out_of_contract = false;
        __scribble_check_state_invariants();
        __scribble_out_of_contract = true;
    }
}
