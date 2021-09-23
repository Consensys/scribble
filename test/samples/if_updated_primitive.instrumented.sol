pragma solidity 0.8.7;

contract Base {
    event AssertionFailed(string message);

    struct vars3 {
        uint256 old_0;
    }

    struct vars6 {
        uint256 old_1;
    }

    uint internal x = 1;
    uint internal y;
    uint internal z;
    uint internal t;
    address internal a = address(0x1);
    uint[] internal arr;

    constructor() {
        Base_a_inline_initializer();
        Base_x_inline_initializer();
        Base_x_uint256_assign(2);
        Base_y_uint256_assign(2);
        Base_a_address_assign(address(0x2));
    }

    function id(uint z) internal returns (uint) {
        return z;
    }

    function main() public {
        Base_x_inc_postfix();
        for (Base_x_uint256_assign(5); x < 10; Base_x_inc_postfix()) Base_y_inc_postfix();
        Base_x_uint256_assign(Base_x_uint256_assign(5));
        Base_x_uint256_assign(id(Base_x_uint256_assign(6)));
        Base_t_delete();
        Base_y_uint256_assign(y + 1);
        Base_x_uint256_assign(Base_x_inc_postfix());
        assert(x == 6);
        Base_x_uint256_assign(Base_x_inc_prefix());
        assert(x == 7);
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

    function Base_a_inline_initializer() internal {
        unchecked {
            if (!(uint160(a) >= 1)) {
                emit AssertionFailed("3: ");
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

    function Base_y_uint256_assign(uint256 ARG1) internal returns (uint256 RET1) {
        vars3 memory _v;
        unchecked {
            _v.old_0 = y;
        }
        y = ARG1;
        RET1 = y;
        unchecked {
            if (!(y >= _v.old_0)) {
                emit AssertionFailed("1: ");
                assert(false);
            }
        }
    }

    function Base_a_address_assign(address ARG2) internal returns (address RET2) {
        a = ARG2;
        RET2 = a;
        unchecked {
            if (!(uint160(a) >= 1)) {
                emit AssertionFailed("3: ");
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
        vars6 memory _v;
        unchecked {
            _v.old_1 = y;
        }
        RET4 = y;
        y++;
        unchecked {
            if (!(y >= _v.old_1)) {
                emit AssertionFailed("1: ");
                assert(false);
            }
        }
    }

    function Base_t_delete() internal {
        delete t;
        unchecked {
            if (!(t == 0)) {
                emit AssertionFailed("2: ");
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

/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}

contract Child is Base {
    function moo() public {
        Base_x_uint256_assign(1);
    }
}
