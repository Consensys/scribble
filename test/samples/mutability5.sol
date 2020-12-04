pragma solidity 0.6.10;
/// invariant {:msg ""} x > 0;
contract Foo {
    uint x = 1;

    function getX() public view returns (uint) {
        return x;
    }

    function getXPlus1() public view returns (uint) {
        return this.getX() + 1;
    }
}