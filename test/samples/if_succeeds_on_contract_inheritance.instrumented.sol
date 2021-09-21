pragma solidity 0.7.0;

/// #if_succeeds {:msg ""} b == a + 1; 
contract Foo {
    event AssertionFailed(string message);

    uint internal a;
    uint internal b;

    function inc(uint x) public returns (uint y) {
        y = _original_Foo_inc(x);
        if (!(b == (a + 1))) {
            emit AssertionFailed("0: ");
            assert(false);
        }
    }

    function _original_Foo_inc(uint x) private returns (uint y) {
        return x + 1;
    }

    function inc2(uint x) virtual public returns (uint y) {
        y = _original_Foo_inc2(x);
        if (!(b == (a + 1))) {
            emit AssertionFailed("0: ");
            assert(false);
        }
    }

    function _original_Foo_inc2(uint x) private returns (uint y) {}
}

/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}

contract Bar is Foo {
    function inc2(uint x) override public returns (uint y) {
        y = _original_Bar_inc2(x);
        if (!(b == (a + 1))) {
            emit AssertionFailed("0: ");
            assert(false);
        }
    }

    function _original_Bar_inc2(uint x) private returns (uint y) {
        return x + 3;
    }

    function inc3(uint x) public pure returns (uint y) {
        return x + 5;
    }
}
