pragma solidity 0.6.12;

contract Foo {
    event AssertionFailed(string message);

    struct vars0 {
        uint256 old_0;
        uint256 oldTT;
        uint256 oldT;
        uint256 old_1;
        uint256 oldTTimes2;
        bool let_0;
        bool let_1;
        bool let_2;
    }

    uint internal t;

    function moo() public {
        vars0 memory _v;
        _v.old_0 = t;
        _v.oldTT = _v.old_0;
        _v.oldT = _v.oldTT;
        _v.old_1 = _v.oldT * 2;
        _v.oldTTimes2 = _v.old_1;
        _original_Foo_moo();
        _v.let_0 = _v.oldTTimes2 == t;
        _v.let_1 = _v.let_0;
        _v.let_2 = _v.let_1;
        if (!(_v.let_2)) {
            emit AssertionFailed("0: ");
            assert(false);
        }
    }

    function _original_Foo_moo() private {
        t = t * 2;
    }
}
/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}
