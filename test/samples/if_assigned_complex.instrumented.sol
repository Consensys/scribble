pragma solidity 0.8.7;

contract Base {
    event AssertionFailed(string message);

    event AssertionFailedData(int eventId, bytes encodingData);

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

    uint internal x;
    uint[] internal arr;
    uint[][] internal arr2;
    S internal s;

    constructor() {
        Base_x_uint256_assign(1);
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

    function Base_x_uint256_assign(uint256 ARG0) internal returns (uint256 RET0) {
        vars1 memory _v;
        unchecked {
            _v.old_0 = x;
        }
        x = ARG0;
        RET0 = x;
        unchecked {
            if (!(x >= _v.old_0)) {
                emit AssertionFailed("0: ");
                emit AssertionFailedData(0, abi.encode(x));
            }
        }
    }

    function Base_arr_idx_uint256_uint256_assign(uint256 ARG1, uint256 ARG2) internal returns (uint256 RET1) {
        arr[ARG1] = ARG2;
        RET1 = arr[ARG1];
        unchecked {
            if (!(arr.length > 0)) {
                emit AssertionFailed("1: ");
                emit AssertionFailedData(1, abi.encode(arr));
            }
            if (!((0 <= ARG1) && (ARG1 <= arr.length))) {
                emit AssertionFailed("2: ");
                emit AssertionFailedData(2, abi.encode(ARG1, arr));
            }
        }
    }

    function Base_arr2_idx_uint256_idx_uint256_uint256_assign(uint256 ARG3, uint256 ARG4, uint256 ARG5) internal returns (uint256 RET2) {
        arr2[ARG3][ARG4] = ARG5;
        RET2 = arr2[ARG3][ARG4];
        unchecked {
            if (!(arr2.length > 0)) {
                emit AssertionFailed("3: ");
                emit AssertionFailedData(3, abi.encode(arr2));
            }
            if (!((0 <= ARG4) && (ARG4 <= arr2[ARG3].length))) {
                emit AssertionFailed("5: ");
                emit AssertionFailedData(5, abi.encode(ARG4, arr2, ARG3));
            }
        }
    }

    function Base_arr2_idx_uint256_ptr_arr_uint256_storage_assign(uint256 ARG6, uint256[] storage ARG7) internal returns (uint256[] storage RET3) {
        arr2[ARG6] = ARG7;
        RET3 = arr2[ARG6];
        unchecked {
            if (!(arr2.length > 0)) {
                emit AssertionFailed("3: ");
                emit AssertionFailedData(3, abi.encode(arr2));
            }
            if (!((0 <= ARG6) && (ARG6 <= arr2.length))) {
                emit AssertionFailed("4: ");
                emit AssertionFailedData(4, abi.encode(ARG6, arr2));
            }
        }
    }

    function Base_s_arr_idx_uint256_uint256_assign(uint256 ARG8, uint256 ARG9) internal returns (uint256 RET4) {
        s.arr[ARG8] = ARG9;
        RET4 = s.arr[ARG8];
        unchecked {
            if (!((0 <= ARG8) && (ARG8 <= s.arr.length))) {
                emit AssertionFailed("6: ");
                emit AssertionFailedData(6, abi.encode(ARG8));
            }
        }
    }

    function Base_s_arr2_idx_uint256_idx_uint256_uint256_assign(uint256 ARG10, uint256 ARG11, uint256 ARG12) internal returns (uint256 RET5) {
        s.arr2[ARG10][ARG11] = ARG12;
        RET5 = s.arr2[ARG10][ARG11];
        unchecked {
            if (!((0 <= ARG11) && (ARG11 <= s.arr2[ARG10].length))) {
                emit AssertionFailed("7: ");
                emit AssertionFailedData(7, abi.encode(ARG11, ARG10));
            }
        }
    }

    function Base_arr_uint256_push(uint256 ARG13) internal {
        arr.push(ARG13);
        unchecked {
            if (!(arr.length > 0)) {
                emit AssertionFailed("1: ");
                emit AssertionFailedData(1, abi.encode(arr));
            }
        }
    }

    function Base_arr2_ptr_arr_uint256_storage_push(uint256[] storage ARG14) internal {
        arr2.push(ARG14);
        unchecked {
            if (!(arr2.length > 0)) {
                emit AssertionFailed("3: ");
                emit AssertionFailedData(3, abi.encode(arr2));
            }
        }
    }
}

/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}

contract Child is Base {
    function moo() public {
        Base_arr_idx_uint256_uint256_assign(0, 10);
    }
}
