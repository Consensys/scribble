pragma solidity 0.8.4;

/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}

/// #invariant forall (uint i in a) a[i] > 10;
contract ForallSimple is __scribble_ReentrancyUtils {
    event AssertionFailed(string message);

    struct vars0 {
        uint256 i0;
        bool forall_0;
    }

    struct vars2 {
        uint256 i1;
        bool forall_1;
        uint256 z1;
        uint256 z2;
        bool let_0;
        bool let_1;
        bool __scribble_check_invs_at_end;
    }

    struct vars3 {
        uint256 i2;
        bool forall_2;
        uint256 old_0;
        bool __scribble_check_invs_at_end;
    }

    struct vars4 {
        uint256 i3;
        bool forall_3;
        uint256 x1;
        uint256 y;
        bool let_2;
        bool let_3;
        bool old_1;
        bool __scribble_check_invs_at_end;
    }

    struct vars5 {
        uint256 i4;
        bool forall_4;
        uint256 j0;
        bool forall_5;
        uint256 old_2;
        bool __scribble_check_invs_at_end;
    }

    struct vars6 {
        uint256 i5;
        bool forall_6;
        bool __scribble_check_invs_at_end;
    }

    struct vars7 {
        uint256 i6;
        bool forall_7;
        bool __scribble_check_invs_at_end;
    }

    struct vars8 {
        uint256 i7;
        bool forall_8;
        bool __scribble_check_invs_at_end;
    }

    struct vars9 {
        uint256 i8;
        bool forall_9;
        bool __scribble_check_invs_at_end;
    }

    struct vars10 {
        uint256 MAX_INT;
        uint256 i9;
        bool forall_10;
        bool let_4;
        bool __scribble_check_invs_at_end;
    }

    uint[] internal a;
    uint internal t = 0;
    uint internal t1 = 0;
    uint internal t2 = 0;

    function push(uint x) external {
        __scribble_out_of_contract = false;
        _original_ForallSimple_push(x);
        __scribble_check_state_invariants();
        __scribble_out_of_contract = true;
    }

    function _original_ForallSimple_push(uint x) private {
        a.push(x);
    }

    function test1(uint[] memory a, uint x) public {
        vars2 memory _v;
        _v.__scribble_check_invs_at_end = __scribble_out_of_contract;
        __scribble_out_of_contract = false;
        _original_ForallSimple_test1(a, x);
        unchecked {
            _v.forall_1 = true;
            for (_v.i1 = 0; _v.i1 < a.length; _v.i1++) {
                _v.z1 = x;
                _v.z2 = a[_v.i1];
                _v.let_0 = _v.z2 > _v.z1;
                _v.let_1 = _v.let_0;
                _v.forall_1 = _v.let_1;
                if (!_v.forall_1) break;
            }
            if (!(_v.forall_1)) {
                emit AssertionFailed("1: ");
                assert(false);
            }
        }
        if (_v.__scribble_check_invs_at_end) __scribble_check_state_invariants();
        __scribble_out_of_contract = _v.__scribble_check_invs_at_end;
    }

    function _original_ForallSimple_test1(uint[] memory a, uint x) private {}

    function test2(uint[] memory a, uint x) public {
        vars3 memory _v;
        _v.__scribble_check_invs_at_end = __scribble_out_of_contract;
        __scribble_out_of_contract = false;
        unchecked {
            _v.old_0 = t;
        }
        _original_ForallSimple_test2(a, x);
        unchecked {
            _v.forall_2 = true;
            for (_v.i2 = 0; _v.i2 < a.length; _v.i2++) {
                _v.forall_2 = a[_v.i2] > _v.old_0;
                if (!_v.forall_2) break;
            }
            if (!(_v.forall_2)) {
                emit AssertionFailed("2: ");
                assert(false);
            }
        }
        if (_v.__scribble_check_invs_at_end) __scribble_check_state_invariants();
        __scribble_out_of_contract = _v.__scribble_check_invs_at_end;
    }

    function _original_ForallSimple_test2(uint[] memory a, uint x) private {
        t = x;
    }

    function test3(uint[] memory a, uint x) public {
        vars4 memory _v;
        _v.__scribble_check_invs_at_end = __scribble_out_of_contract;
        __scribble_out_of_contract = false;
        unchecked {
            _v.forall_3 = true;
            for (_v.i3 = 0; _v.i3 < a.length; _v.i3++) {
                _v.x1 = a[_v.i3];
                _v.y = t1;
                _v.let_2 = _v.x1 > _v.y;
                _v.let_3 = _v.let_2;
                _v.forall_3 = _v.let_3;
                if (!_v.forall_3) break;
            }
            _v.old_1 = _v.forall_3;
        }
        _original_ForallSimple_test3(a, x);
        unchecked {
            if (!(_v.old_1)) {
                emit AssertionFailed("3: ");
                assert(false);
            }
        }
        if (_v.__scribble_check_invs_at_end) __scribble_check_state_invariants();
        __scribble_out_of_contract = _v.__scribble_check_invs_at_end;
    }

    function _original_ForallSimple_test3(uint[] memory a, uint x) private {
        t1 = x;
    }

    function test4(uint[][] memory a, uint x) public {
        vars5 memory _v;
        _v.__scribble_check_invs_at_end = __scribble_out_of_contract;
        __scribble_out_of_contract = false;
        unchecked {
            _v.old_2 = t2;
        }
        _original_ForallSimple_test4(a, x);
        unchecked {
            _v.forall_4 = true;
            for (_v.i4 = 0; _v.i4 < a.length; _v.i4++) {
                _v.forall_5 = true;
                for (_v.j0 = 0; _v.j0 < a[_v.i4].length; _v.j0++) {
                    _v.forall_5 = a[_v.i4][_v.j0] > _v.old_2;
                    if (!_v.forall_5) break;
                }
                _v.forall_4 = _v.forall_5;
                if (!_v.forall_4) break;
            }
            if (!(_v.forall_4)) {
                emit AssertionFailed("4: ");
                assert(false);
            }
        }
        if (_v.__scribble_check_invs_at_end) __scribble_check_state_invariants();
        __scribble_out_of_contract = _v.__scribble_check_invs_at_end;
    }

    function _original_ForallSimple_test4(uint[][] memory a, uint x) private {
        t2 = x;
    }

    function test5() public {
        vars6 memory _v;
        _v.__scribble_check_invs_at_end = __scribble_out_of_contract;
        __scribble_out_of_contract = false;
        _original_ForallSimple_test5();
        unchecked {
            _v.forall_6 = true;
            for (_v.i5 = 1; _v.i5 < 5; _v.i5++) {
                _v.forall_6 = (_v.i5 >= 1) && (_v.i5 < 5);
                if (!_v.forall_6) break;
            }
            if (!(_v.forall_6)) {
                emit AssertionFailed("5: ");
                assert(false);
            }
        }
        if (_v.__scribble_check_invs_at_end) __scribble_check_state_invariants();
        __scribble_out_of_contract = _v.__scribble_check_invs_at_end;
    }

    function _original_ForallSimple_test5() private {}

    function test6() public {
        vars7 memory _v;
        _v.__scribble_check_invs_at_end = __scribble_out_of_contract;
        __scribble_out_of_contract = false;
        _original_ForallSimple_test6();
        unchecked {
            _v.forall_7 = true;
            for (_v.i6 = 1; _v.i6 < 5; _v.i6++) {
                _v.forall_7 = _v.i6 > 1;
                if (!_v.forall_7) break;
            }
            if (!(_v.forall_7)) {
                emit AssertionFailed("6: ");
                assert(false);
            }
        }
        if (_v.__scribble_check_invs_at_end) __scribble_check_state_invariants();
        __scribble_out_of_contract = _v.__scribble_check_invs_at_end;
    }

    function _original_ForallSimple_test6() private {}

    function test7() public {
        vars8 memory _v;
        _v.__scribble_check_invs_at_end = __scribble_out_of_contract;
        __scribble_out_of_contract = false;
        _original_ForallSimple_test7();
        unchecked {
            _v.forall_8 = true;
            for (_v.i7 = 1; _v.i7 < 5; _v.i7++) {
                _v.forall_8 = _v.i7 < 4;
                if (!_v.forall_8) break;
            }
            if (!(_v.forall_8)) {
                emit AssertionFailed("7: ");
                assert(false);
            }
        }
        if (_v.__scribble_check_invs_at_end) __scribble_check_state_invariants();
        __scribble_out_of_contract = _v.__scribble_check_invs_at_end;
    }

    function _original_ForallSimple_test7() private {}

    function test11() public {
        vars9 memory _v;
        _v.__scribble_check_invs_at_end = __scribble_out_of_contract;
        __scribble_out_of_contract = false;
        _original_ForallSimple_test11();
        unchecked {
            _v.forall_9 = true;
            for (_v.i8 = 5; _v.i8 < 5; _v.i8++) {
                _v.forall_9 = false;
                if (!_v.forall_9) break;
            }
            if (!(_v.forall_9)) {
                emit AssertionFailed("8: ");
                assert(false);
            }
        }
        if (_v.__scribble_check_invs_at_end) __scribble_check_state_invariants();
        __scribble_out_of_contract = _v.__scribble_check_invs_at_end;
    }

    function _original_ForallSimple_test11() private {}

    function test12() public {
        vars10 memory _v;
        _v.__scribble_check_invs_at_end = __scribble_out_of_contract;
        __scribble_out_of_contract = false;
        _original_ForallSimple_test12();
        unchecked {
            _v.MAX_INT = uint256(((2 ** 255) - 1) + (2 ** 255));
            _v.forall_10 = true;
            for (_v.i9 = _v.MAX_INT; _v.i9 < _v.MAX_INT; _v.i9++) {
                _v.forall_10 = false;
                if (!_v.forall_10) break;
            }
            _v.let_4 = _v.forall_10;
            if (!(_v.let_4)) {
                emit AssertionFailed("9: ");
                assert(false);
            }
        }
        if (_v.__scribble_check_invs_at_end) __scribble_check_state_invariants();
        __scribble_out_of_contract = _v.__scribble_check_invs_at_end;
    }

    function _original_ForallSimple_test12() private {}

    /// Check only the current contract's state invariants
    function __scribble_ForallSimple_check_state_invariants_internal() internal {
        vars0 memory _v;
        unchecked {
            _v.forall_0 = true;
            for (_v.i0 = 0; _v.i0 < a.length; _v.i0++) {
                _v.forall_0 = a[_v.i0] > 10;
                if (!_v.forall_0) break;
            }
            if (!(_v.forall_0)) {
                emit AssertionFailed("0: ");
                assert(false);
            }
        }
    }

    /// Check the state invariant for the current contract and all its bases
    function __scribble_check_state_invariants() virtual internal {
        __scribble_ForallSimple_check_state_invariants_internal();
    }

    constructor() {
        __scribble_out_of_contract = false;
        __scribble_check_state_invariants();
        __scribble_out_of_contract = true;
    }
}
