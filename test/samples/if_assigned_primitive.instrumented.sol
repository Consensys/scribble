pragma solidity 0.8.3;

contract Base {
    event AssertionFailed(string message);

    struct vars1 {
        uint256 old_0;
    }

    struct vars5 {
        uint256 old_1;
    }

    struct vars7 {
        uint256 old_2;
    }

    uint internal x = 1;
    uint internal y = 2;
    uint internal z;
    address internal a = address(0x1);
    uint[] internal arr;

    constructor() {
        Base_a_inline_initializer();
        Base_y_inline_initializer();
        Base_x_inline_initializer();
        Base_x_uint256_assign(2);
        Base_a_address_assign(address(0x2));
    }

    function id(uint z) internal returns (uint) {
        return z;
    }

    function main() public {
        Base_x_inc_postfix();
        assert(x == 3);
        for (Base_x_uint256_assign(5); x < 10; Base_x_inc_postfix()) Base_y_inc_postfix();
        assert((x == 10) && (y == 7));
        Base_x_uint256_assign(Base_x_uint256_assign(5));
        assert(x == 6);
        Base_x_uint256_assign(id(Base_x_uint256_assign(6)));
        assert(x == 7);
        Base_x_delete();
        assert(x == 0);
        Base_y_uint256_assign(y + 1);
        assert(y == 8);
        Base_x_uint256_assign(Base_x_inc_postfix());
        assert(x == 0);
        Base_x_uint256_assign(Base_x_inc_prefix());
        assert(x == 1);
        arr.push(1);
        arr.push(2);
    }

    function Base_x_inline_initializer() internal {
        unchecked {
            if (!(x >= 1)) {
                emit AssertionFailed("0: ");
                assert(false);
            }
        }
    }

    function Base_y_inline_initializer() internal {
        vars1 memory _v;
        unchecked {
            _v.old_0 = y;
        }
        unchecked {
            if (!(y >= _v.old_0)) {
                emit AssertionFailed("1: ");
                assert(false);
            }
        }
    }

    function Base_a_inline_initializer() internal {
        unchecked {
            if (!(uint160(a) >= 1)) {
                emit AssertionFailed("2: ");
                assert(false);
            }
        }
    }

    function Base_x_uint256_assign(uint256 ARG0) internal returns (uint256 RET0) {
        x = ARG0;
        RET0 = x;
        unchecked {
            if (!(x >= 1)) {
                emit AssertionFailed("0: ");
                assert(false);
            }
        }
    }

    function Base_a_address_assign(address ARG1) internal returns (address RET1) {
        a = ARG1;
        RET1 = a;
        unchecked {
            if (!(uint160(a) >= 1)) {
                emit AssertionFailed("2: ");
                assert(false);
            }
        }
    }

    function Base_y_uint256_assign(uint256 ARG2) internal returns (uint256 RET2) {
        vars5 memory _v;
        unchecked {
            _v.old_1 = y;
        }
        y = ARG2;
        RET2 = y;
        unchecked {
            if (!(y >= _v.old_1)) {
                emit AssertionFailed("1: ");
                assert(false);
            }
        }
    }

    function Base_x_inc_postfix() internal returns (uint256 RET3) {
        RET3 = x;
        x++;
        unchecked {
            if (!(x >= 1)) {
                emit AssertionFailed("0: ");
                assert(false);
            }
        }
    }

    function Base_y_inc_postfix() internal returns (uint256 RET4) {
        vars7 memory _v;
        unchecked {
            _v.old_2 = y;
        }
        RET4 = y;
        y++;
        unchecked {
            if (!(y >= _v.old_2)) {
                emit AssertionFailed("1: ");
                assert(false);
            }
        }
    }

    function Base_x_delete() internal {
        delete x;
        unchecked {
            if (!(x >= 1)) {
                emit AssertionFailed("0: ");
                assert(false);
            }
        }
    }

    function Base_x_inc_prefix() internal returns (uint256 RET5) {
        ++x;
        RET5 = x;
        unchecked {
            if (!(x >= 1)) {
                emit AssertionFailed("0: ");
                assert(false);
            }
        }
    }
}

contract Child is Base {
    function moo() public {
        Base_x_uint256_assign(1);
    }
}
/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}
