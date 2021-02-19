pragma solidity 0.6.10;

contract Foo {
    event AssertionFailed(string message);

    struct vars0 {
        uint256 dummy_;
        uint256 x;
        bool let_0;
    }

    function snd(uint v) internal pure returns (uint, uint) {
        return (1, v);
    }

    function foo(uint v) public {
        vars0 memory _v;
        _original_Foo_foo(v);
        (_v.dummy_, _v.x) = snd(v);
        _v.let_0 = _v.x == 2;
        if (!(_v.let_0)) {
            emit AssertionFailed("0: P0");
            assert(false);
        }
    }

    function _original_Foo_foo(uint v) private {}
}
/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}
