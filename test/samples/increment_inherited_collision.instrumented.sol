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

    /// if_succeeds {:msg "P0"} y == _v+1;
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

/// invariant {:msg ""} t >= 1;
contract Foo is __scribble_ReentrancyUtils1, __scribble_ReentrancyUtils {
    event AssertionFailed(string message);

    struct vars7 {
        bool __scribble_check_invs_at_end;
    }

    uint internal t = 1;

    function foo(uint256 _v) override public returns (uint256 y) {
        vars7 memory _v1;
        _v1.__scribble_check_invs_at_end = __scribble_out_of_contract1;
        __scribble_out_of_contract1 = false;
        y = _original_Foo_foo1(_v);
        if ((!((y == (_v + 1))))) {
            emit AssertionFailed("1: P0");
            assert(false);
        }
        if (_v1.__scribble_check_invs_at_end) __scribble_check_state_invariants1();
        __scribble_out_of_contract1 = _v1.__scribble_check_invs_at_end;
    }

    function _original_Foo_foo1(uint256 _v) private returns (uint256 y) {
        (t++);
        return (_v + 1);
    }

    function __scribble_Foo_check_state_invariants_internal() internal {
        assert(false);
    }

    /// Check only the current contract's state invariants
    function __scribble_Foo_check_state_invariants_internal1() internal {
        if ((!((t >= 1)))) {
            emit AssertionFailed("0: ");
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
