pragma solidity 0.7.5;

contract Foo {
    event AssertionFailed(string message);

    struct vars0 {
        uint256 p;
        uint256 t;
        bool let_0;
        bool let_1;
    }

    function div(uint a, uint b) public returns (uint c) {
        vars0 memory _v;
        c = _original_Foo_div(a, b);
        _v.p = b;
        _v.t = a / _v.p;
        _v.let_0 = _v.t == c;
        _v.let_1 = _v.let_0;
        if (!(_v.let_1)) {
            emit AssertionFailed("0: ");
            assert(false);
        }
    }

    function _original_Foo_div(uint a, uint b) private pure returns (uint c) {
        return a / b;
    }
}
/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}
