pragma solidity 0.6.10;

/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}
/// invariant {:msg ""} x>0;
contract Foo is __scribble_ReentrancyUtils {
    event AssertionFailed(string message);

    struct vars1 {
        bool __scribble_check_invs_at_end;
    }

    struct vars2 {
        bool __scribble_check_invs_at_end;
    }

    struct vars3 {
        bool __scribble_check_invs_at_end;
    }

    int internal x = 1;

    function inc() public payable {
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

    function fail_int() internal {
        x = 0;
        _callsite_23(this.inc, 0);
        x = 0;
        _callsite_34(this.inc, 10000);
        x = 0;
        _callsite_45(this.inc, 0, 10000);
        x = 0;
        _callsite_59(this.inc, 0, 10000);
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
        fail_int();
    }

    function withdraw(uint _amount) public {
        vars3 memory _v;
        _v.__scribble_check_invs_at_end = __scribble_out_of_contract;
        __scribble_out_of_contract = false;
        _original_Foo_withdraw(_amount);
        if (_v.__scribble_check_invs_at_end) __scribble_check_state_invariants();
        __scribble_out_of_contract = _v.__scribble_check_invs_at_end;
    }

    function _original_Foo_withdraw(uint _amount) private {
        (bool success, bytes memory retval) = _callsite_83(msg.sender, _amount, "");
        require(success);
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

    function _callsite_23(function() external payable fPtr, uint256 _value) private {
        __scribble_check_state_invariants();
        __scribble_out_of_contract = true;
        fPtr{value: _value}();
        __scribble_out_of_contract = false;
    }

    function _callsite_34(function() external payable fPtr, uint256 _gas) private {
        __scribble_check_state_invariants();
        __scribble_out_of_contract = true;
        fPtr{gas: _gas}();
        __scribble_out_of_contract = false;
    }

    function _callsite_45(function() external payable fPtr, uint256 _value, uint256 _gas) private {
        __scribble_check_state_invariants();
        __scribble_out_of_contract = true;
        fPtr{gas: _gas, value: _value}();
        __scribble_out_of_contract = false;
    }

    function _callsite_59(function() external payable fPtr, uint256 _value, uint256 _gas) private {
        __scribble_check_state_invariants();
        __scribble_out_of_contract = true;
        fPtr{gas: _gas, value: _value}();
        __scribble_out_of_contract = false;
    }

    function _callsite_83(address payable receiver, uint256 _value, bytes memory arg0) private returns (bool ret0, bytes memory ret1) {
        __scribble_check_state_invariants();
        __scribble_out_of_contract = true;
        (ret0, ret1) = receiver.call{value: _value}(arg0);
        __scribble_out_of_contract = false;
    }
}
