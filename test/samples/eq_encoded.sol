// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.19;

contract Sample {
    struct Some {
        uint a;
    }

    uint[3] a;
    uint[] b;
    Some c;

    /// #if_succeeds eq_encoded("a", "b");
    /// #if_succeeds eq_encoded(hex"01", hex"02");
    /// #if_succeeds eq_encoded(Some(1), c);
    /// #if_succeeds eq_encoded(a, b);
    /// #if_succeeds eq_encoded(a, "1");
    /// #if_succeeds eq_encoded(hex"010203", b);
    function foo(uint256 x, uint256 y, uint256 z) public returns (uint256) {
        return x + y + z;
    }
}
