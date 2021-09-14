pragma solidity 0.8.7;

/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}

/// #invariant {:msg ""} b == a + c - 1; 
contract Foo is __scribble_ReentrancyUtils {
    event AssertionFailed(string message);

    event AssertionFailedData(int eventId, bytes encodingData);

    uint internal a = 2;
    uint internal b = 101;
    uint internal c = 100;

    function inc5(uint x) external view returns (uint y) {
        return x + 5;
    }

    /// Check only the current contract's state invariants
    function __scribble_Foo_check_state_invariants_internal() internal {
        unchecked {
            if (!(b == ((a + c) - 1))) {
                emit AssertionFailed("0: ");
                emit AssertionFailedData(0, abi.encode(b, a, c));
            }
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

contract Base is __scribble_ReentrancyUtils, Foo {
    function inc3(uint x) external returns (uint y) {
        __scribble_out_of_contract = false;
        y = _original_Base_inc3(x);
        __scribble_check_state_invariants();
        __scribble_out_of_contract = true;
    }

    function _original_Base_inc3(uint x) private returns (uint y) {
        a += x + 1;
        return x + 1;
    }

    /// Check only the current contract's state invariants
    function __scribble_Base_check_state_invariants_internal() internal {}

    /// Check the state invariant for the current contract and all its bases
    function __scribble_check_state_invariants() virtual override internal {
        __scribble_Base_check_state_invariants_internal();
        __scribble_Foo_check_state_invariants_internal();
    }

    constructor() {
        __scribble_out_of_contract = false;
        __scribble_check_state_invariants();
        __scribble_out_of_contract = true;
    }
}
