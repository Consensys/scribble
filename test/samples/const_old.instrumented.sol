pragma solidity 0.8.7;

contract Foo {
    event AssertionFailed(string message);

    function main() public {
        _original_Foo_main();
        unchecked {
            if (!(1 > 0)) {
                emit AssertionFailed("0: ");
                assert(false);
            }
        }
    }

    function _original_Foo_main() private {}
}

/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}
