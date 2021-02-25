pragma solidity 0.7.5;

abstract contract __scribble_ReentrancyUtils {
    uint __scribble_out_of_contract;
    enum vars0 {
        A
    }

    enum vars1 {
        B
    }

    enum vars2 {
        C
    }

    function __scribble_check_state_invariants(uint x) public returns (uint) {
        return x;
    }

    function __scribble_check_state_invariants() public {
        assert(false);
    }

    function __scribble___scribble_ReentrancyUtils_check_state_invariants_internal() internal {
        assert(false);
    }

    /// if_succeeds {:msg "P0"} let foo := y in
    ///         let  __mstore_scratch__ := foo in
    ///             let __scribble_check_invs_at_end := __mstore_scratch__ in
    ///                 __scribble_check_invs_at_end == _v+1;
    function foo(uint256 _v) virtual public returns (uint256 y);

    function _original_Foo_foo(uint256 _v) private returns (uint256 y) {
        return _v;
    }
}

/// invariant {:msg ""} t >= 1;
contract Foo is __scribble_ReentrancyUtils {
    uint t = 1;
    function foo(uint256 _v) override public returns (uint256 y) {
        t++;
        return _v + 1;
    }

    function __scribble_Foo_check_state_invariants_internal() internal {
        assert(false);
    }
}
