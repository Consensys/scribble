pragma solidity 0.6.10;
contract Test {
    /**
     * Leading string
     * 
     * #if_succeeds {:msg "P0"} y
     *     \o/ x;
     *
     * Trailing string
     */
    function foo(uint256 x) public returns (uint256 y) {
        return x + 1;
    }
}
