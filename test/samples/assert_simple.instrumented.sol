pragma solidity 0.8.7;

contract SimpleAsserts {
    event AssertionFailed(string message);

    function main(uint a1, uint a2, uint a3, bool b1, uint a4, uint a5, uint a6, uint a7, uint a8) public {
        unchecked {
            if (!(a1 == 1)) {
                emit AssertionFailed("0: ");
                assert(false);
            }
        }
        uint x = 2;
        unchecked {
            if (!(a2 == x)) {
                emit AssertionFailed("1: ");
                assert(false);
            }
        }
        x++;
        unchecked {
            if (!(a3 == x)) {
                emit AssertionFailed("2: ");
                assert(false);
            }
        }
        if (b1) {
            unchecked {
                if (!(a4 == (x + 1))) {
                    emit AssertionFailed("3: ");
                    assert(false);
                }
            }
            {
                unchecked {
                    if (!(a5 == (x + 2))) {
                        emit AssertionFailed("4: ");
                        assert(false);
                    }
                }
                x++;
            }
        } else {
            x++;
            unchecked {
                if (!(a6 == (x + 2))) {
                    emit AssertionFailed("5: ");
                    assert(false);
                }
            }
            int t;
        }
        while (a6 > 0) {
            unchecked {
                if (!(a7 >= (a6 + 1))) {
                    emit AssertionFailed("6: ");
                    assert(false);
                }
            }
            a6--;
        }
        unchecked {
            if (!(a8 == (x + 4))) {
                emit AssertionFailed("7: ");
                assert(false);
            }
        }
        {
            x++;
        }
    }
}

/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}
