pragma solidity 0.6.10;

/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}
/// invariant {:msg ""} x > 0;
contract Foo is __scribble_ReentrancyUtils {
    event AssertionFailed(string message);

    uint internal x = 1;

    function getX() public view returns (uint) {
        return x;
    }

    function getXPlus1() public returns (uint) {
        return (_callsite_23(this.getX) + 1);
    }

    /// Check only the current contract's state invariants
    function __scribble_Foo_check_state_invariants_internal() internal {
        if ((!((x > 0)))) {
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

    function _callsite_23(function() external view returns (uint) fPtr) private returns (uint ret0) {
        __scribble_check_state_invariants();
        __scribble_out_of_contract = true;
        (ret0) = fPtr();
        __scribble_out_of_contract = false;
    }
}
