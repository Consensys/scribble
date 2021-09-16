pragma solidity 0.8.7;

contract IfUpdatedPrimitive {
    event AssertionFailed(string message);

    struct vars0 {
        address tuple_tmp_0;
        uint256 tuple_tmp_1;
        uint256 tuple_tmp_2;
        uint256 tuple_tmp_3;
        address tuple_tmp_4;
        uint256 tuple_tmp_5;
        address tuple_tmp_6;
        uint256 tuple_tmp_7;
        uint256 tuple_tmp_8;
        uint256 tuple_tmp_9;
        uint256 tuple_tmp_10;
        uint256 tuple_tmp_11;
        uint256 tuple_tmp_12;
    }

    uint internal x = 1;
    uint internal y = 2;
    address internal a = address(0x1);

    constructor() {
        IfUpdatedPrimitive_a_inline_initializer();
        IfUpdatedPrimitive_x_inline_initializer();
        IfUpdatedPrimitive_x_uint256_assign(2);
        IfUpdatedPrimitive_a_address_assign(address(0x2));
    }

    function getTwo() internal returns (uint, address) {
        return (4, address(0x4));
    }

    function id(uint z) internal returns (uint) {
        return z;
    }

    function main() public {
        vars0 memory _v;
        (_v.tuple_tmp_1, _v.tuple_tmp_0) = (x + 1, address(uint160(a) + 1));
        IfUpdatedPrimitive_a_address_assign(_v.tuple_tmp_0);
        IfUpdatedPrimitive_x_uint256_assign(_v.tuple_tmp_1);
        assert((x == 3) && (a == address(0x3)));
        (_v.tuple_tmp_3, _v.tuple_tmp_2) = (y, x);
        y = _v.tuple_tmp_2;
        IfUpdatedPrimitive_x_uint256_assign(_v.tuple_tmp_3);
        assert((x == 2) && (y == 3));
        (_v.tuple_tmp_5, _v.tuple_tmp_4) = getTwo();
        IfUpdatedPrimitive_a_address_assign(_v.tuple_tmp_4);
        IfUpdatedPrimitive_x_uint256_assign(_v.tuple_tmp_5);
        assert(x == 4);
        IfUpdatedPrimitive_x_uint256_assign(1);
        (_v.tuple_tmp_8, (_v.tuple_tmp_7, _v.tuple_tmp_6)) = (1, getTwo());
        IfUpdatedPrimitive_a_address_assign(_v.tuple_tmp_6);
        IfUpdatedPrimitive_x_uint256_assign(_v.tuple_tmp_7);
        y = _v.tuple_tmp_8;
        assert((y == 1) && (x == 4));
        (_v.tuple_tmp_10, _v.tuple_tmp_9) = (y == 1) ? (3, 4) : (5, 6);
        y = _v.tuple_tmp_9;
        IfUpdatedPrimitive_x_uint256_assign(_v.tuple_tmp_10);
        assert((x == 3) && (y == 4));
        (_v.tuple_tmp_12, _v.tuple_tmp_11) = (x == 0) ? (0, 0) : ((x == 3) ? (1, 1) : (0, 0));
        y = _v.tuple_tmp_11;
        IfUpdatedPrimitive_x_uint256_assign(_v.tuple_tmp_12);
        assert((x == 1) && (y == 1));
    }

    function IfUpdatedPrimitive_x_inline_initializer() internal {
        unchecked {
            if (!(x >= 1)) {
                emit AssertionFailed("0: ");
                assert(false);
            }
        }
    }

    function IfUpdatedPrimitive_a_inline_initializer() internal {
        unchecked {
            if (!(uint160(a) >= 1)) {
                emit AssertionFailed("1: ");
                assert(false);
            }
        }
    }

    function IfUpdatedPrimitive_x_uint256_assign(uint256 ARG0) internal returns (uint256 RET0) {
        x = ARG0;
        RET0 = x;
        unchecked {
            if (!(x >= 1)) {
                emit AssertionFailed("0: ");
                assert(false);
            }
        }
    }

    function IfUpdatedPrimitive_a_address_assign(address ARG1) internal returns (address RET1) {
        a = ARG1;
        RET1 = a;
        unchecked {
            if (!(uint160(a) >= 1)) {
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
