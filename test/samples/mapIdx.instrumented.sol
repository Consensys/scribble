pragma solidity 0.6.12;

contract MapIdx {
    event AssertionFailed(string message);

    mapping(string => int) internal a;

    function main(string memory arg) public {
        _original_MapIdx_main(arg);
        if ((!((a[arg] == 0)))) {
            emit AssertionFailed("0: F");
            assert(false);
        }
    }

    function _original_MapIdx_main(string memory arg) private {}
}
/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}
