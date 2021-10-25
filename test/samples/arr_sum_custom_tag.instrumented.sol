pragma solidity 0.8.4;

contract Foo {
    event AssertionFailed(string message);

    uint[] internal a = [10];
    int8[] internal b;

    function pushA(uint k) public {
        _original_Foo_pushA(k);
        unchecked {
            if (!((arr_sum_funs.sum_arr_uint256_arr_storage(a) > 10) && (arr_sum_funs.sum_arr_uint256_arr_storage(a) < 20))) {
                emit AssertionFailed("0: ");
                assert(false);
            }
        }
    }

    function _original_Foo_pushA(uint k) private {
        a.push(k);
    }

    function setA(uint k, uint v) public {
        _original_Foo_setA(k, v);
        unchecked {
            if (!((arr_sum_funs.sum_arr_uint256_arr_storage(a) > 10) && (arr_sum_funs.sum_arr_uint256_arr_storage(a) < 20))) {
                emit AssertionFailed("1: ");
                assert(false);
            }
        }
    }

    function _original_Foo_setA(uint k, uint v) private {
        a[k] = v;
    }

    function pushB(int8 k) public {
        _original_Foo_pushB(k);
        unchecked {
            if (!((arr_sum_funs.sum_arr_int8_arr_storage(b) > (-10)) && (arr_sum_funs.sum_arr_int8_arr_storage(b) < 10))) {
                emit AssertionFailed("2: ");
                assert(false);
            }
        }
    }

    function _original_Foo_pushB(int8 k) private {
        b.push(k);
    }

    function setB(uint k, int8 v) public {
        _original_Foo_setB(k, v);
        unchecked {
            if (!((arr_sum_funs.sum_arr_int8_arr_storage(b) > (-10)) && (arr_sum_funs.sum_arr_int8_arr_storage(b) < 10))) {
                emit AssertionFailed("3: ");
                assert(false);
            }
        }
    }

    function _original_Foo_setB(uint k, int8 v) private {
        b[k] = v;
    }

    function memArr(int16[] memory c) public {
        _original_Foo_memArr(c);
        unchecked {
            if (!((arr_sum_funs.sum_arr_int16_arr_memory(c) > (-10)) && (arr_sum_funs.sum_arr_int16_arr_memory(c) < 10))) {
                emit AssertionFailed("4: ");
                assert(false);
            }
        }
    }

    function _original_Foo_memArr(int16[] memory c) private {}

    function calldataArr(int16[] calldata c) external {
        _original_Foo_calldataArr(c);
        unchecked {
            if (!((arr_sum_funs.sum_arr_int16_arr_calldata(c) > (-10)) && (arr_sum_funs.sum_arr_int16_arr_calldata(c) < 10))) {
                emit AssertionFailed("5: ");
                assert(false);
            }
        }
    }

    function _original_Foo_calldataArr(int16[] calldata c) private {}

    function overflowCheck(uint[] calldata c) external {
        _original_Foo_overflowCheck(c);
        unchecked {
            if (!(arr_sum_funs.sum_arr_uint256_arr_calldata(c) < 10)) {
                emit AssertionFailed("6: ");
                assert(false);
            }
        }
    }

    function _original_Foo_overflowCheck(uint[] calldata c) private {}
}

/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}

library arr_sum_funs {
    function sum_arr_uint256_arr_storage(uint256[] storage arr) internal returns (uint256 ret) {
        unchecked {
            for (uint256 idx = 0; idx < arr.length; idx++) ret += arr[idx];
        }
    }

    function sum_arr_int8_arr_storage(int8[] storage arr) internal returns (int256 ret) {
        unchecked {
            for (uint256 idx = 0; idx < arr.length; idx++) ret += arr[idx];
        }
    }

    function sum_arr_int16_arr_memory(int16[] memory arr) internal returns (int256 ret) {
        unchecked {
            for (uint256 idx = 0; idx < arr.length; idx++) ret += arr[idx];
        }
    }

    function sum_arr_int16_arr_calldata(int16[] calldata arr) internal returns (int256 ret) {
        unchecked {
            for (uint256 idx = 0; idx < arr.length; idx++) ret += arr[idx];
        }
    }

    function sum_arr_uint256_arr_calldata(uint256[] calldata arr) internal returns (uint256 ret) {
        unchecked {
            for (uint256 idx = 0; idx < arr.length; idx++) ret += arr[idx];
        }
    }
}
