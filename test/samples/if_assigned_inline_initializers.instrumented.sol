pragma solidity 0.8.3;

contract Base {
    event AssertionFailed(string message);

    struct S {
        uint[] arr;
        uint[][] arr2;
    }

    struct vars0 {
        uint256 old_0;
    }

    struct vars4 {
        uint256 old_1;
    }

    uint internal x = 1;
    uint[] internal arr = [1];
    uint[][] internal arr2 = [[1, 2], [3, 4]];
    S internal s = Base.S({arr: arr, arr2: arr2});

    function Base_x_inline_initializer() internal {
        vars0 memory _v;
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

    constructor() {
        Base_s_inline_initializer();
        Base_arr2_inline_initializer();
        Base_arr_inline_initializer();
        Base_x_inline_initializer();
    }

    function Base_arr_inline_initializer() internal {
        unchecked {
            if (!(arr.length > 0)) {
                emit AssertionFailed("1: ");
                assert(false);
            }
        }
    }

    function Base_arr2_inline_initializer() internal {
        unchecked {
            if (!(arr2.length > 0)) {
                emit AssertionFailed("3: ");
                assert(false);
            }
        }
    }

    function Base_s_inline_initializer() internal {
        unchecked {
            if (!(s.arr.length > 0)) {
                emit AssertionFailed("6: ");
                assert(false);
            }
        }
    }

    function Base_x_uint256_assign(uint256 ARG0) internal returns (uint256 RET0) {
        vars4 memory _v;
        unchecked {
            _v.old_1 = x;
        }
        x = ARG0;
        RET0 = x;
        unchecked {
            if (!(x >= _v.old_1)) {
                emit AssertionFailed("0: ");
                assert(false);
            }
        }
    }

    function Base_arr_ptr_arr_uint8_1_memory_assign(uint8[1] memory ARG1) internal returns (uint256[] storage RET1) {
        arr = ARG1;
        RET1 = arr;
        unchecked {
            if (!(arr.length > 0)) {
                emit AssertionFailed("1: ");
                assert(false);
            }
        }
    }

    function Base_arr2_ptr_arr_ptr_arr_uint8_1_memory_2_memory_assign(uint8[1][2] memory ARG2) internal returns (uint256[][] storage RET2) {
        arr2 = ARG2;
        RET2 = arr2;
        unchecked {
            if (!(arr2.length > 0)) {
                emit AssertionFailed("3: ");
                assert(false);
            }
        }
    }
}

contract Child is Base {
    constructor() {
        Base_x_uint256_assign(4);
        Base_arr_ptr_arr_uint8_1_memory_assign([4]);
        Base_arr2_ptr_arr_ptr_arr_uint8_1_memory_2_memory_assign([[1], [2]]);
        s.arr = arr;
        s.arr2 = arr2;
    }
}
/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}
