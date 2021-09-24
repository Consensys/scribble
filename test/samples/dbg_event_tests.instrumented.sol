pragma solidity 0.8.4;

contract Foo {
    event AssertionFailed(string message);

    event AssertionFailedData(int eventId, bytes encodingData);

    struct vars0 {
        uint256 dbg_0;
        uint256 old_0;
    }

    struct vars2 {
        uint256[] dbg_1;
        uint256 old_1;
    }

    struct vars5 {
        uint256 x1;
        uint256 x2;
        uint256 x3;
        bool let_0;
        bool let_1;
        bool let_2;
    }

    struct vars8 {
        uint256[] dbg_2;
        uint256 old_2;
    }

    uint[] internal x = [1, 2];
    uint internal t = 1;
    uint[] internal arr = [0, 0, 0, 0];
    uint[] internal arr1;
    mapping(string => uint[]) internal m;

    function changesArg1(uint x) public {
        vars0 memory _v;
        unchecked {
            _v.dbg_0 = x;
            _v.old_0 = x;
        }
        _original_Foo_changesArg1(x);
        unchecked {
            if (!(_v.old_0 == 0)) {
                emit AssertionFailed("4: ");
                emit AssertionFailedData(4, abi.encode(_v.dbg_0));
            }
        }
    }

    function _original_Foo_changesArg1(uint x) private {
        x = 1;
    }

    function changesArg2(uint x) public {
        _original_Foo_changesArg2(x);
        unchecked {
            if (!(x == 0)) {
                emit AssertionFailed("5: ");
                emit AssertionFailedData(5, abi.encode(x));
            }
        }
    }

    function _original_Foo_changesArg2(uint x) private {
        x = 1;
    }

    function changesArr1() public {
        vars2 memory _v;
        unchecked {
            _v.dbg_1 = x;
            _v.old_1 = x[0];
        }
        _original_Foo_changesArr1();
        unchecked {
            if (!(_v.old_1 == 0)) {
                emit AssertionFailed("6: ");
                emit AssertionFailedData(6, abi.encode(_v.dbg_1));
            }
        }
    }

    function _original_Foo_changesArr1() private {
        x[0] = 3;
    }

    function changesArr2() public {
        _original_Foo_changesArr2();
        unchecked {
            if (!(x[0] == 0)) {
                emit AssertionFailed("7: ");
                emit AssertionFailedData(7, abi.encode(x));
            }
        }
    }

    function _original_Foo_changesArr2() private {
        x[0] = 4;
    }

    function newRet() public returns (uint RET) {
        RET = _original_Foo_newRet();
        unchecked {
            if (!(RET == 1)) {
                emit AssertionFailed("8: ");
                emit AssertionFailedData(8, abi.encode(RET));
            }
        }
    }

    function _original_Foo_newRet() private returns (uint RET) {
        return 2;
    }

    function shadowing(uint x) public {
        vars5 memory _v;
        _original_Foo_shadowing(x);
        unchecked {
            _v.x1 = x + 1;
            _v.x2 = _v.x1 + 1;
            _v.x3 = _v.x2 + 1;
            _v.let_0 = (_v.x3 + _v.x3) == 8;
            _v.let_1 = _v.let_0;
            _v.let_2 = _v.let_1;
            if (!(_v.let_2)) {
                emit AssertionFailed("9: ");
                emit AssertionFailedData(9, abi.encode(x, _v.x1, _v.x2, _v.x3));
            }
        }
    }

    function _original_Foo_shadowing(uint x) private {}

    function updArr() public {
        Foo_arr_idx_uint256_uint256_assign(1, 2);
    }

    constructor() {
        Foo_arr_inline_initializer();
        arr1 = [0, 0, 0, 7];
    }

    function updArrOld() public {
        Foo_arr1_idx_uint256_uint256_assign(3, 8);
    }

    function assignInd0() public {
        Foo_m_idx_ptr_string_memory_ptr_arr_uint256_1_memory_assign("abc", [uint(1)]);
    }

    function assignInd1() public {
        Foo_m_idx_ptr_string_memory_ptr_arr_uint8_3_memory_assign("abc", [1, 2, 3]);
        Foo_m_idx_ptr_string_memory_idx_uint256_uint256_assign("abc", 1, 0);
    }

    function Foo_arr_inline_initializer() internal {
        unchecked {
            if (!(arr[t] == 3)) {
                emit AssertionFailed("0: ");
                emit AssertionFailedData(0, abi.encode(arr, t));
            }
        }
    }

    function Foo_arr_idx_uint256_uint256_assign(uint256 ARG0, uint256 ARG1) internal returns (uint256 RET0) {
        arr[ARG0] = ARG1;
        RET0 = arr[ARG0];
        unchecked {
            if (!(arr[t] == 3)) {
                emit AssertionFailed("0: ");
                emit AssertionFailedData(0, abi.encode(arr, t));
            }
        }
    }

    function Foo_arr1_idx_uint256_uint256_assign(uint256 ARG2, uint256 ARG3) internal returns (uint256 RET1) {
        vars8 memory _v;
        unchecked {
            _v.dbg_2 = arr1;
            _v.old_2 = arr1[3];
        }
        arr1[ARG2] = ARG3;
        RET1 = arr1[ARG2];
        unchecked {
            if (!(_v.old_2 == 3)) {
                emit AssertionFailed("1: ");
                emit AssertionFailedData(1, abi.encode(_v.dbg_2));
            }
        }
    }

    function Foo_m_idx_ptr_string_memory_ptr_arr_uint256_1_memory_assign(string memory ARG4, uint256[1] memory ARG5) internal returns (uint256[] storage RET2) {
        m[ARG4] = ARG5;
        RET2 = m[ARG4];
        unchecked {
            if (!(m[ARG4].length > 1)) {
                emit AssertionFailed("2: ");
                emit AssertionFailedData(2, abi.encode(ARG4));
            }
        }
    }

    function Foo_m_idx_ptr_string_memory_ptr_arr_uint8_3_memory_assign(string memory ARG6, uint8[3] memory ARG7) internal returns (uint256[] storage RET3) {
        m[ARG6] = ARG7;
        RET3 = m[ARG6];
        unchecked {
            if (!(m[ARG6].length > 1)) {
                emit AssertionFailed("2: ");
                emit AssertionFailedData(2, abi.encode(ARG6));
            }
        }
    }

    function Foo_m_idx_ptr_string_memory_idx_uint256_uint256_assign(string memory ARG8, uint256 ARG9, uint256 ARG10) internal returns (uint256 RET4) {
        m[ARG8][ARG9] = ARG10;
        RET4 = m[ARG8][ARG9];
        unchecked {
            if (!(m[ARG8][ARG9] > 0)) {
                emit AssertionFailed("3: ");
                emit AssertionFailedData(3, abi.encode(ARG8, ARG9));
            }
        }
    }
}

/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}
