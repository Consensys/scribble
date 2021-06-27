pragma solidity 0.6.10;

/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}
/// #invariant {:msg ""} x>0;
contract Foo is __scribble_ReentrancyUtils {
    event AssertionFailed(string message);

    event AssertionFailedData(bytes encodingData, int eventId);

    struct vars0 {
        bytes encoded_logger_args0;
    }

    struct vars1 {
        bytes encoded_logger_args0;
        bool __scribble_check_invs_at_end;
    }

    struct vars2 {
        bytes encoded_logger_args0;
        bool __scribble_check_invs_at_end;
    }

    int internal x = 1;

    function inc() public {
        vars1 memory _v;
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
        x += v;
    }

    function fail() public {
        vars2 memory _v;
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
        vars0 memory _v;
        if (!(x > 0)) {
            emit AssertionFailed("0: ");
            _v.encoded_logger_args0 = abi.encode(x);
            emit AssertionFailedData(_v.encoded_logger_args0, 0);
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
