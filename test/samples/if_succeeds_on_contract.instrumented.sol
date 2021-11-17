pragma solidity 0.7.0;

/// #if_succeeds {:msg ""} b == a + old(1);
///  #if_succeeds {:msg ""} b == a&1; 
contract Foo {
    event AssertionFailed(string message);

    uint internal a;
    uint internal b;

    function inc(uint x) public returns (uint y) {
        y = _original_Foo_inc(x);
        if (!(b == (a ^ 1))) {
            emit AssertionFailed("2: ");
            assert(false);
        }
        if (!(b == (a + 1))) {
            emit AssertionFailed("0: ");
            assert(false);
        }
        if (!(b == (a & 1))) {
            emit AssertionFailed("1: ");
            assert(false);
        }
    }

    function _original_Foo_inc(uint x) private returns (uint y) {
        return x + 1;
    }

    function inc2(uint x) external view returns (uint y) {
        return x + 1;
    }

    function inc3(uint x) private view returns (uint y) {
        return x + 1;
    }

    function inc4(uint x) internal view returns (uint y) {
        return x + 1;
    }

    function inc5(uint x) public pure returns (uint y) {
        return x + 2;
    }
}

/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}
