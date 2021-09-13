pragma solidity 0.8.7;

contract IfUpdatedAliasing {
    event AssertionFailed(string message);

    struct vars0 {
        uint256 tuple_tmp_0;
        uint256 tuple_tmp_1;
        uint256 tuple_tmp_2;
        uint256 tuple_tmp_3;
        uint256[] tuple_tmp_4;
        uint256 tuple_tmp_5;
        uint256[] tuple_tmp_6;
        uint256 tuple_tmp_7;
    }

    uint[] internal a1;
    uint[] internal a2;
    uint[] internal a3;
    uint[] internal a4;
    uint[][] internal aa1;
    uint[][] internal aa2;

    function main() public {
        vars0 memory _v;
        IfUpdatedAliasing_a1_uint256_push(1);
        uint[] storage p = a2;
        p.push(2);
        _v.tuple_tmp_1 = 0;
        _v.tuple_tmp_3 = 0;
        (_v.tuple_tmp_2, _v.tuple_tmp_0) = (p[0], a1[0]);
        p[_v.tuple_tmp_1] = _v.tuple_tmp_0;
        IfUpdatedAliasing_a1_idx_uint256_uint256_assign(_v.tuple_tmp_3, _v.tuple_tmp_2);
        assert((a1[0] == 2) && (a2[0] == 1));
        IfUpdatedAliasing_aa1_ptr_arr_uint256_storage_push(a1);
        uint[][] storage pp = aa2;
        pp.push(a2);
        assert((aa1[0][0] == 2) && (aa2[0][0] == 1));
        _v.tuple_tmp_5 = 0;
        _v.tuple_tmp_7 = 0;
        (_v.tuple_tmp_6, _v.tuple_tmp_4) = (pp[0], aa1[0]);
        pp[_v.tuple_tmp_5] = _v.tuple_tmp_4;
        IfUpdatedAliasing_aa1_idx_uint256_ptr_arr_uint256_memory_assign(_v.tuple_tmp_7, _v.tuple_tmp_6);
        assert((aa1[0][0] == 2) && (aa2[0][0] == 2));
        uint i;
        (p, i) = (1 > 2) ? (a2, 1) : ((2 > 3) ? (a3, 2) : (a4, 3));
    }

    function IfUpdatedAliasing_a1_idx_uint256_uint256_assign(uint256 ARG0, uint256 ARG1) internal returns (uint256 RET0) {
        a1[ARG0] = ARG1;
        RET0 = a1[ARG0];
        unchecked {
            if (!(true)) {
                emit AssertionFailed("0: ");
                assert(false);
            }
        }
    }

    function IfUpdatedAliasing_aa1_idx_uint256_ptr_arr_uint256_memory_assign(uint256 ARG2, uint256[] memory ARG3) internal returns (uint256[] storage RET1) {
        aa1[ARG2] = ARG3;
        RET1 = aa1[ARG2];
        unchecked {
            if (!(true)) {
                emit AssertionFailed("1: ");
                assert(false);
            }
        }
    }

    function IfUpdatedAliasing_a1_uint256_push(uint256 ARG4) internal {
        a1.push(ARG4);
        unchecked {
            if (!(true)) {
                emit AssertionFailed("0: ");
                assert(false);
            }
        }
    }

    function IfUpdatedAliasing_aa1_ptr_arr_uint256_storage_push(uint256[] storage ARG5) internal {
        aa1.push(ARG5);
        unchecked {
            if (!(true)) {
                emit AssertionFailed("1: ");
                assert(false);
            }
        }
    }
}

/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}
