pragma solidity 0.5.17;

contract PointerSwap {
    event AssertionFailed(string message);

    struct vars0 {
        uint256[] tuple_tmp_0;
        uint256[] tuple_tmp_1;
    }

    uint[] internal a = [1, 2, 3];
    uint[] internal b = [4, 5, 6];

    function main() public {
        vars0 memory _v;
        (_v.tuple_tmp_1, _v.tuple_tmp_0) = (b, a);
        b = _v.tuple_tmp_0;
        PointerSwap_a_ptr_arr_uint256_memory_assign(_v.tuple_tmp_1);
        assert((a[0] == 4) && (b[0] == 1));
    }

    function PointerSwap_a_inline_initializer() internal {
        if (!(true)) {
            emit AssertionFailed("0: ");
            assert(false);
        }
    }

    constructor() public {
        PointerSwap_a_inline_initializer();
    }

    function PointerSwap_a_ptr_arr_uint256_memory_assign(uint256[] memory ARG0) internal returns (uint256[] storage RET0) {
        a = ARG0;
        RET0 = a;
        if (!(true)) {
            emit AssertionFailed("0: ");
            assert(false);
        }
    }
}

/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}
