pragma solidity 0.6.12;

contract TypePtr {
    event AssertionFailed(string message);

    uint256[] internal _nums;

    function entry() external {
        _original_TypePtr_entry();
        if (!(_isEvenLen(_nums))) {
            emit AssertionFailed("0: P1");
            assert(false);
        }
    }

    function _original_TypePtr_entry() private {
        require(_isEvenLen(_nums));
        _nums.push();
    }

    function _isEvenLen(uint256[] memory arr) internal view returns (bool) {
        return (arr.length % 2) == 0;
    }
}
/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}
