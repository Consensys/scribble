pragma solidity 0.8.3;

contract Base {
    event AssertionFailed(string message);

    struct S {
        uint[] arr;
        uint[][] arr2;
    }

    struct vars0 {
        uint256 tuple_tmp_0;
        uint256 tuple_tmp_1;
        uint256 tuple_tmp_2;
        uint256 tuple_tmp_3;
    }

    struct vars1 {
        uint256 old_0;
    }

    uint internal x = 1;
    uint[] internal arr;
    uint[][] internal arr2;
    S internal s;

    constructor() {
        Base_x_inline_initializer();
    }

    function main() public {
        vars0 memory _v;
        Base_arr_uint256_push(1);
        Base_arr_uint256_push(2);
        Base_arr_idx_uint256_uint256_assign(0, 3);
        assert((arr[0] == 3) && (arr[1] == 2));
        _v.tuple_tmp_1 = 1;
        _v.tuple_tmp_3 = 0;
        (_v.tuple_tmp_2, _v.tuple_tmp_0) = (5, (6));
        Base_arr_idx_uint256_uint256_assign(_v.tuple_tmp_1, _v.tuple_tmp_0);
        Base_arr_idx_uint256_uint256_assign(_v.tuple_tmp_3, _v.tuple_tmp_2);
        assert((arr[0] == 5) && (arr[1] == 6));
        Base_arr2_ptr_arr_uint256_storage_push(arr);
        Base_arr2_idx_uint256_idx_uint256_uint256_assign(0, 1, 7);
        assert((arr2[0][0] == 5) && (arr2[0][1] == 7));
        Base_arr2_idx_uint256_ptr_arr_uint256_storage_assign(0, arr);
        assert((arr2[0][0] == 5) && (arr2[0][1] == 6));
        s.arr.push(10);
        s.arr.push(11);
        assert(((s.arr.length == 2) && (s.arr[0] == 10)) && (s.arr[1] == 11));
        Base_s_arr_idx_uint256_uint256_assign(0, 12);
        Base_s_arr_idx_uint256_uint256_assign(1, 13);
        assert(((s.arr.length == 2) && (s.arr[0] == 12)) && (s.arr[1] == 13));
        s.arr2.push(s.arr);
        assert(((s.arr2.length == 1) && (s.arr2[0][0] == 12)) && (s.arr2[0][1] == 13));
        s.arr2[0] = s.arr;
        Base_s_arr2_idx_uint256_idx_uint256_uint256_assign(0, 1, 14);
        assert(s.arr2[0][1] == 14);
    }

    function Base_x_inline_initializer() internal {
        vars1 memory _v;
        unchecked {
            _v.old_0 = x;
        }
        unchecked {
            if (!(x >= _v.old_0)) {
                emit AssertionFailed("0: ");
                assert(false);
            }
        }
    }

    function Base_arr_idx_uint256_uint256_assign(uint256 ARG0, uint256 ARG1) internal returns (uint256 RET0) {
        arr[ARG0] = ARG1;
        RET0 = arr[ARG0];
        unchecked {
            if (!(arr.length > 0)) {
                emit AssertionFailed("1: ");
                assert(false);
            }
            if (!((0 <= ARG0) && (ARG0 <= arr.length))) {
                emit AssertionFailed("2: ");
                assert(false);
            }
        }
    }

    function Base_arr2_idx_uint256_idx_uint256_uint256_assign(uint256 ARG2, uint256 ARG3, uint256 ARG4) internal returns (uint256 RET1) {
        arr2[ARG2][ARG3] = ARG4;
        RET1 = arr2[ARG2][ARG3];
        unchecked {
            if (!(arr2.length > 0)) {
                emit AssertionFailed("3: ");
                assert(false);
            }
            if (!((0 <= ARG3) && (ARG3 <= arr2[ARG2].length))) {
                emit AssertionFailed("5: ");
                assert(false);
            }
        }
    }

    function Base_arr2_idx_uint256_ptr_arr_uint256_storage_assign(uint256 ARG5, uint256[] storage ARG6) internal returns (uint256[] storage RET2) {
        arr2[ARG5] = ARG6;
        RET2 = arr2[ARG5];
        unchecked {
            if (!(arr2.length > 0)) {
                emit AssertionFailed("3: ");
                assert(false);
            }
            if (!((0 <= ARG5) && (ARG5 <= arr2.length))) {
                emit AssertionFailed("4: ");
                assert(false);
            }
        }
    }

    function Base_s_arr_idx_uint256_uint256_assign(uint256 ARG7, uint256 ARG8) internal returns (uint256 RET3) {
        s.arr[ARG7] = ARG8;
        RET3 = s.arr[ARG7];
        unchecked {
            if (!((0 <= ARG7) && (ARG7 <= s.arr.length))) {
                emit AssertionFailed("6: ");
                assert(false);
            }
        }
    }

    function Base_s_arr2_idx_uint256_idx_uint256_uint256_assign(uint256 ARG9, uint256 ARG10, uint256 ARG11) internal returns (uint256 RET4) {
        s.arr2[ARG9][ARG10] = ARG11;
        RET4 = s.arr2[ARG9][ARG10];
        unchecked {
            if (!((0 <= ARG10) && (ARG10 <= s.arr2[ARG9].length))) {
                emit AssertionFailed("7: ");
                assert(false);
            }
        }
    }

    function Base_arr_uint256_push(uint256 ARG12) internal {
        arr.push(ARG12);
        unchecked {
            if (!(arr.length > 0)) {
                emit AssertionFailed("1: ");
                assert(false);
            }
        }
    }

    function Base_arr2_ptr_arr_uint256_storage_push(uint256[] storage ARG13) internal {
        arr2.push(ARG13);
        unchecked {
            if (!(arr2.length > 0)) {
                emit AssertionFailed("3: ");
                assert(false);
            }
        }
    }
}

contract Child is Base {
    function moo() public {
        Base_arr_idx_uint256_uint256_assign(0, 10);
    }
}
/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}
