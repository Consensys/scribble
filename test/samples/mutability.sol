pragma solidity 0.6.10;
contract Base {
    function getX() virtual view public returns (uint) {
        return 1;
    }
}

contract Foo is Base{
    uint x = 1;
    
    /// #if_succeeds {:msg ""} x > 0;
    function getX() virtual view override public returns (uint) {
        return x;
    }
}

contract Child is Foo {
    function getX() virtual view override public returns (uint) {
        return x+1;
    }
}

/// #invariant {:msg ""} x > 0;
contract Baz {
    uint x = 1;
    
    /// #if_succeeds {:msg ""} x > 0;
    function getX() view public returns (uint) {
        return x;
    }
    
    function getXPlus1() view public returns (uint) {
        return getX()+1;
    }

    /// #if_succeeds {:msg ""} x > 2;
    function getXPlus2() view public returns (uint) {
        return getXPlus1()+1;
    }
}
