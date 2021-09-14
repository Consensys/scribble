pragma solidity 0.7.5;

/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils1 {
    bool __scribble_out_of_contract1 = true;
}

abstract contract __scribble_ReentrancyUtils is __scribble_ReentrancyUtils1 {
    enum vars0 { A }

    enum vars1 { B }

    enum vars2 { C }

    struct vars4 {
        bool __scribble_check_invs_at_end;
    }

    struct vars5 {
        bool __scribble_check_invs_at_end;
    }

    uint internal __scribble_out_of_contract;

    function __scribble_check_state_invariants(uint x) public returns (uint RET_0) {
        vars4 memory _v1;
        _v1.__scribble_check_invs_at_end = __scribble_out_of_contract1;
        __scribble_out_of_contract1 = false;
        RET_0 = _original___scribble_ReentrancyUtils___scribble_check_state_invariants(x);
        if (_v1.__scribble_check_invs_at_end) __scribble_check_state_invariants1();
        __scribble_out_of_contract1 = _v1.__scribble_check_invs_at_end;
    }

    function _original___scribble_ReentrancyUtils___scribble_check_state_invariants(uint x) private returns (uint) {
        return x;
    }

    function __scribble_check_state_invariants() public {
        vars5 memory _v1;
        _v1.__scribble_check_invs_at_end = __scribble_out_of_contract1;
        __scribble_out_of_contract1 = false;
        _original___scribble_ReentrancyUtils___scribble_check_state_invariants1();
        if (_v1.__scribble_check_invs_at_end) __scribble_check_state_invariants1();
        __scribble_out_of_contract1 = _v1.__scribble_check_invs_at_end;
    }

    function _original___scribble_ReentrancyUtils___scribble_check_state_invariants1() private {
        assert(false);
    }

    function __scribble___scribble_ReentrancyUtils_check_state_invariants_internal() internal {
        assert(false);
    }

    /// #if_succeeds {:msg "P0"} let foo := y in
    ///          let  __mstore_scratch__ := foo in
    ///              let __scribble_check_invs_at_end := __mstore_scratch__ in
    ///                  __scribble_check_invs_at_end == _v+1;
    function foo(uint256 _v) virtual public returns (uint256 y);

    function _original_Foo_foo(uint256 _v) private returns (uint256 y) {
        return _v;
    }

    /// Check only the current contract's state invariants
    function __scribble___scribble_ReentrancyUtils_check_state_invariants_internal1() internal {}

    /// Check the state invariant for the current contract and all its bases
    function __scribble_check_state_invariants1() virtual internal {
        __scribble___scribble_ReentrancyUtils_check_state_invariants_internal1();
    }

    constructor() {
        __scribble_out_of_contract1 = false;
        __scribble_check_state_invariants1();
        __scribble_out_of_contract1 = true;
    }
}

/// #invariant {:msg ""} t >= 1;
contract Foo is __scribble_ReentrancyUtils1, __scribble_ReentrancyUtils {
    event AssertionFailed(string message);

    struct vars7 {
        uint256 foo1;
        uint256 __mstore_scratch__1;
        uint256 __scribble_check_invs_at_end1;
        bool let_0;
        bool let_1;
        bool let_2;
        bool __scribble_check_invs_at_end;
    }

    uint internal t = 1;

    function foo(uint256 _v) override public returns (uint256 y) {
        vars7 memory _v1;
        _v1.__scribble_check_invs_at_end = __scribble_out_of_contract1;
        __scribble_out_of_contract1 = false;
        y = _original_Foo_foo1(_v);
        _v1.foo1 = y;
        _v1.__mstore_scratch__1 = _v1.foo1;
        _v1.__scribble_check_invs_at_end1 = _v1.__mstore_scratch__1;
        _v1.let_0 = _v1.__scribble_check_invs_at_end1 == (_v + 1);
        _v1.let_1 = _v1.let_0;
        _v1.let_2 = _v1.let_1;
        if (!(_v1.let_2)) {
            emit AssertionFailed("0: P0");
            assert(false);
        }
        if (_v1.__scribble_check_invs_at_end) __scribble_check_state_invariants1();
        __scribble_out_of_contract1 = _v1.__scribble_check_invs_at_end;
    }

    function _original_Foo_foo1(uint256 _v) private returns (uint256 y) {
        t++;
        return _v + 1;
    }

    function __scribble_Foo_check_state_invariants_internal() internal {
        assert(false);
    }

    /// Check only the current contract's state invariants
    function __scribble_Foo_check_state_invariants_internal1() internal {
        if (!(t >= 1)) {
            emit AssertionFailed("1: ");
            assert(false);
        }
    }

    /// Check the state invariant for the current contract and all its bases
    function __scribble_check_state_invariants1() virtual override internal {
        __scribble_Foo_check_state_invariants_internal1();
        __scribble___scribble_ReentrancyUtils_check_state_invariants_internal1();
    }

    constructor() {
        __scribble_out_of_contract1 = false;
        __scribble_check_state_invariants1();
        __scribble_out_of_contract1 = true;
    }
}
