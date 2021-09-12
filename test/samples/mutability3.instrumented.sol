pragma solidity 0.6.10;

contract Base {
    function getX() virtual public returns (uint) {
        return 1;
    }
}

/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}

contract Foo is Base {
    event AssertionFailed(string message);

    uint internal x = 1;

    function getX() virtual override public returns (uint RET_0) {
        RET_0 = _original_Foo_getX();
        if (!(x > 0)) {
            emit AssertionFailed("0: ");
            assert(false);
        }
    }

    function _original_Foo_getX() private view returns (uint) {
        return x;
    }
}

contract Child is Foo {
    function getX() virtual override public returns (uint RET_0) {
        RET_0 = _original_Child_getX();
        if (!(x > 0)) {
            emit AssertionFailed("0: ");
            assert(false);
        }
    }

    function _original_Child_getX() private returns (uint) {
        return x + 1;
    }
}
