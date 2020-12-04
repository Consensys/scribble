pragma solidity 0.6.12;
contract TypePtr {
    uint256[] _nums;

    /// if_succeeds {:msg "P1"} _isEvenLen(_nums);
    function entry() external {
        require(_isEvenLen(_nums));
        _nums.push();
    }

    function _isEvenLen(uint256[] memory arr) internal view returns (bool) {
        return arr.length % 2 == 0;
    }
}
