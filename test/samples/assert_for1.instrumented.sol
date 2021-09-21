pragma solidity 0.8.7;

contract Foo {
    event AssertionFailed(string message);

    function main(uint n) public {
        uint sum = 0;
        unchecked {
            if (!(true)) {
                emit AssertionFailed("0: ");
                assert(false);
            }
        }
        uint i = 0;
        for (; i < n; i++) {
            sum += i;
        }
    }
}

/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}
