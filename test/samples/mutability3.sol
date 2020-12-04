pragma solidity 0.6.10;
contract Base {
    function getX() virtual view public returns (uint) {
        return 1;
    }
}

contract Foo is Base{
    uint x = 1;
    
    /// if_succeeds {:msg ""} x > 0;
    function getX() virtual view override public returns (uint) {
        return x;
    }
}

contract Child is Foo {
    function getX() virtual view override public returns (uint) {
        return x+1;
    }
}