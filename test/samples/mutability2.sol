pragma solidity 0.6.10;
contract Foo {
    uint x = 1;
    
    /// if_succeeds {:msg ""} x > 0;
    function getX() view public returns (uint) {
        return x;
    }
    
    function getXPlus1() view public returns (uint) {
        return getX()+1;
    }

    function getXPlus2() view public returns (uint) {
        return getXPlus1()+1;
    }
}