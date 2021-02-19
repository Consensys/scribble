pragma solidity 0.6.10;

/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}
/// invariant {:msg "P1"} true;
contract Test is __scribble_ReentrancyUtils {
    event AssertionFailed(string message);

    struct vars2 {
        bool __scribble_check_invs_at_end;
    }

    function foo(bytes calldata x) external returns (bytes calldata y) {
        __scribble_out_of_contract = false;
        y = _original_Test_foo(x);
        __scribble_check_state_invariants();
        __scribble_out_of_contract = true;
    }

    function _original_Test_foo(bytes calldata x) private returns (bytes calldata y) {
        y = x;
    }

    function moo() public {
        vars2 memory _v;
        _v.__scribble_check_invs_at_end = __scribble_out_of_contract;
        __scribble_out_of_contract = false;
        _original_Test_moo();
        if (_v.__scribble_check_invs_at_end) __scribble_check_state_invariants();
        __scribble_out_of_contract = _v.__scribble_check_invs_at_end;
    }

    function _original_Test_moo() private {
        bytes memory m = "abc";
        bytes memory n = _callsite_27(this.foo, m);
        assert(n[0] == "a");
        assert(n[1] == "b");
        assert(n[2] == "c");
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

    function _callsite_27(function(bytes memory) external returns (bytes memory) fPtr, bytes memory arg0) private returns (bytes memory ret0) {
        __scribble_check_state_invariants();
        __scribble_out_of_contract = true;
        (ret0) = fPtr(arg0);
        __scribble_out_of_contract = false;
    }
}
