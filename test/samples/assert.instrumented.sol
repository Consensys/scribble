/// This file is auto-generated by Scribble and shouldn't be edited directly.
/// Use --disarm prior to make any changes.
pragma solidity 0.8.10;

contract AssertFor1 {
    function main(uint n) public {
        uint sum = 0;
        unchecked {
            if (!(true)) {
                emit __ScribbleUtilsLib__235.AssertionFailed("000289:0067:000 3: ");
                assert(false);
            }
        }
        uint i = 0;
        for (; i < n; i++) {
            sum += i;
        }
    }
}

contract AssertFor2 {
    function main(uint n) public {
        uint sum = 0;
        for (uint i = 0; i < n; ) {
            sum += i;
            unchecked {
                if (!(true)) {
                    emit __ScribbleUtilsLib__235.AssertionFailed("000715:0067:000 4: ");
                    assert(false);
                }
            }
            i++;
        }
    }
}

contract AssertForAll {
    struct vars4 {
        uint256 i0;
        bool forall_0;
    }

    function main(uint[] memory n) public {
        vars4 memory _v;
        uint sum = 0;
        unchecked {
            _v.forall_0 = true;
            for (_v.i0 = 0; _v.i0 < n.length; _v.i0++) {
                _v.forall_0 = n[_v.i0] < 100;
                if (!_v.forall_0) break;
            }
            if (!(_v.forall_0)) {
                emit __ScribbleUtilsLib__235.AssertionFailed("001331:0067:000 5: ");
                assert(false);
            }
        }
        for (uint i = 0; i < n.length; i++) {
            sum += n[i];
        }
    }
}

contract AssertFunCall {
    struct vars5 {
        uint256 oldSum;
        uint256 a9;
        uint256 b2;
        bool let_0;
        bool let_1;
    }

    uint internal t;

    function foo(uint x, uint y) public view returns (uint, uint) {
        return (x + t, y + t);
    }

    function boo(uint a, uint b) public pure returns (uint) {
        return a + b;
    }

    function main(uint a, uint b, uint newT) public returns (uint) {
        vars5 memory _v;
        t = newT;
        unchecked {
            _v.oldSum = a + b;
            (_v.a9, _v.b2) = foo(a, b);
            _v.let_0 = (_v.oldSum + (2 * 1)) == (_v.a9 + _v.b2);
            _v.let_1 = _v.let_0;
            if (!(_v.let_1)) {
                emit __ScribbleUtilsLib__235.AssertionFailed("002267:0067:000 6: ");
                assert(false);
            }
        }
        boo(a, b);
    }
}

/// #invariant sum < 200;
contract AssertMixed {
    struct vars1 {
        bool __scribble_check_invs_at_end;
    }

    struct vars6 {
        uint256 i1;
        bool forall_1;
    }

    struct vars8 {
        uint256 old_0;
    }

    uint internal sum;

    function main(uint[] memory n) public {
        vars1 memory _v;
        _v.__scribble_check_invs_at_end = !__ScribbleUtilsLib__235.isInContract();
        __ScribbleUtilsLib__235.setInContract(true);
        _original_AssertMixed_main(n);
        unchecked {
            if (!(n.length < 10)) {
                emit __ScribbleUtilsLib__235.AssertionFailed("002995:0067:000 2: ");
                assert(false);
            }
        }
        if (_v.__scribble_check_invs_at_end) __scribble_check_state_invariants();
        __ScribbleUtilsLib__235.setInContract(!_v.__scribble_check_invs_at_end);
    }

    function _original_AssertMixed_main(uint[] memory n) internal {
        vars6 memory _v;
        unchecked {
            _v.forall_1 = true;
            for (_v.i1 = 0; _v.i1 < n.length; _v.i1++) {
                _v.forall_1 = n[_v.i1] <= 50;
                if (!_v.forall_1) break;
            }
            if (!(_v.forall_1)) {
                emit __ScribbleUtilsLib__235.AssertionFailed("003642:0067:000 7: ");
                assert(false);
            }
        }
        for (uint i = 0; i < n.length; i++) {
            unchecked {
                if (!(n[i] > 2)) {
                    emit __ScribbleUtilsLib__235.AssertionFailed("003891:0067:000 8: ");
                    assert(false);
                }
            }
            AssertMixed_sum_uint256_plus_assign(n[i]);
        }
    }

    /// Check only the current contract's state invariants
    function __scribble_AssertMixed_check_state_invariants_internal() internal {
        unchecked {
            if (!(sum < 200)) {
                emit __ScribbleUtilsLib__235.AssertionFailed("004307:0067:000 0: ");
                assert(false);
            }
        }
    }

    /// Check the state invariant for the current contract and all its bases
    function __scribble_check_state_invariants() virtual internal {
        __scribble_AssertMixed_check_state_invariants_internal();
    }

    constructor() {
        __ScribbleUtilsLib__235.setInContract(true);
        __scribble_check_state_invariants();
        __ScribbleUtilsLib__235.setInContract(false);
    }

    function AssertMixed_sum_uint256_plus_assign(uint256 ARG0) internal returns (uint256 RET0) {
        vars8 memory _v;
        unchecked {
            _v.old_0 = sum;
        }
        sum += ARG0;
        RET0 = sum;
        unchecked {
            if (!((sum - _v.old_0) > 3)) {
                emit __ScribbleUtilsLib__235.AssertionFailed("005135:0067:000 1: ");
                assert(false);
            }
        }
    }
}

contract SimpleAsserts {
    function main(uint a1, uint a2, uint a3, bool b1, uint a4, uint a5, uint a6, uint a7, uint a8) public {
        unchecked {
            if (!(a1 == 1)) {
                emit __ScribbleUtilsLib__235.AssertionFailed("005467:0067:000 9: ");
                assert(false);
            }
        }
        uint x = 2;
        unchecked {
            if (!(a2 == x)) {
                emit __ScribbleUtilsLib__235.AssertionFailed("005677:0068:000 10: ");
                assert(false);
            }
        }
        x++;
        unchecked {
            if (!(a3 == x)) {
                emit __ScribbleUtilsLib__235.AssertionFailed("005881:0068:000 11: ");
                assert(false);
            }
        }
        if (b1) {
            unchecked {
                if (!(a4 == (x + 1))) {
                    emit __ScribbleUtilsLib__235.AssertionFailed("006108:0068:000 12: ");
                    assert(false);
                }
            }
            {
                unchecked {
                    if (!(a5 == (x + 2))) {
                        emit __ScribbleUtilsLib__235.AssertionFailed("006355:0068:000 13: ");
                        assert(false);
                    }
                }
                x++;
            }
        } else {
            x++;
            unchecked {
                if (!(a6 == (x + 2))) {
                    emit __ScribbleUtilsLib__235.AssertionFailed("006657:0068:000 14: ");
                    assert(false);
                }
            }
            int t;
        }
        while (a6 > 0) {
            unchecked {
                if (!(a7 >= (a6 + 1))) {
                    emit __ScribbleUtilsLib__235.AssertionFailed("006933:0068:000 15: ");
                    assert(false);
                }
            }
            a6--;
        }
        unchecked {
            if (!(a8 == (x + 4))) {
                emit __ScribbleUtilsLib__235.AssertionFailed("007170:0068:000 16: ");
                assert(false);
            }
        }
        {
            x++;
        }
    }
}

library __ScribbleUtilsLib__235 {
    event AssertionFailed(string message);

    event AssertionFailedData(int eventId, bytes encodingData);

    function assertionFailed(string memory arg_0) internal {
        emit AssertionFailed(arg_0);
    }

    function assertionFailedData(int arg_0, bytes memory arg_1) internal {
        emit AssertionFailedData(arg_0, arg_1);
    }

    function isInContract() internal returns (bool res) {
        assembly {
            res := sload(0x5f0b92cf9616afdee4f4136f66393f1343b027f01be893fa569eb2e2b667a40c)
        }
    }

    function setInContract(bool v) internal {
        assembly {
            sstore(0x5f0b92cf9616afdee4f4136f66393f1343b027f01be893fa569eb2e2b667a40c, v)
        }
    }
}
