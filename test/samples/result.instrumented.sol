pragma solidity 0.7.5;

contract Foo {
    event AssertionFailed(string message);

    struct vars1 {
        uint256 t;
        bool let_0;
    }

    struct vars2 {
        uint256 a;
        uint256 b;
        bool let_1;
    }

    function a() public returns (uint RET_0) {
        RET_0 = _original_Foo_a();
        if ((!((RET_0 == 1)))) {
            emit AssertionFailed("0: ");
            assert(false);
        }
    }

    function _original_Foo_a() private returns (uint) {
        return 1;
    }

    function b() public returns (uint x) {
        vars1 memory _v;
        x = _original_Foo_b();
        _v.t = x;
        _v.let_0 = (_v.t == x);
        if ((!((x == x)))) {
            emit AssertionFailed("1: ");
            assert(false);
        }
        if ((!(_v.let_0))) {
            emit AssertionFailed("2: ");
            assert(false);
        }
    }

    function _original_Foo_b() private returns (uint x) {
        x = 2;
    }

    function d() public returns (uint RET_0, uint t) {
        vars2 memory _v;
        (RET_0, t) = _original_Foo_d();
        _v.a = RET_0;
        _v.b = t;
        _v.let_1 = (((_v.a == 1) && (_v.b == 2)) && (t == _v.b));
        if ((!(_v.let_1))) {
            emit AssertionFailed("3: ");
            assert(false);
        }
    }

    function _original_Foo_d() private returns (uint, uint t) {
        return (1, 2);
    }
}
/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}
