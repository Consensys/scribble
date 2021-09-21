pragma solidity 0.8.7;

contract AssertFunCall {
    event AssertionFailed(string message);

    struct vars0 {
        uint256 oldSum;
        uint256 a1;
        uint256 b1;
        bool let_0;
        bool let_1;
    }

    uint internal t;

    function foo(uint x, uint y) public view returns (uint, uint) {
        return (x + t, y + t);
    }

    function boo(uint a, uint b) public pure returns (uint) {
        return a + b;
    }

    function main(uint a, uint b, uint newT) public returns (uint) {
        vars0 memory _v;
        t = newT;
        unchecked {
            _v.oldSum = a + b;
            (_v.a1, _v.b1) = foo(a, b);
            _v.let_0 = (_v.oldSum + (2 * 1)) == (_v.a1 + _v.b1);
            _v.let_1 = _v.let_0;
            if (!(_v.let_1)) {
                emit AssertionFailed("0: ");
                assert(false);
            }
        }
        boo(a, b);
    }
}

/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}
