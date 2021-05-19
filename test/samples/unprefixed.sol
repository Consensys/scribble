pragma solidity 0.6.10;
/**
 * define some(uint a) uint = 1 + a;
 *
 * invariant
 *      some(1) != 2;
 */
contract Foo {
    /// if_succeeds
    ///     {:msg "P0"}
    ///         1 == 1
    ///             ;
    ///
    /// if_succeeds {:msg "P1"} y == x + 1;
    function foo(uint256 x) public returns (uint256 y) {
        return x + 1;
    }
}
