pragma solidity 0.7.5;

contract Foo {
    event AssertionFailed(string message);

    struct vars0 {
        uint256 oldX;
        uint256 oldY;
        bool let_0;
    }

    uint internal x;
    uint internal y;

    function dbl() internal view returns (uint, uint) {
        return (x, y);
    }

    function main(uint k) public {
        vars0 memory _v;
        (_v.oldX, _v.oldY) = dbl();
        _original_Foo_main(k);
        _v.let_0 = (x == (_v.oldX + k)) && (y == (_v.oldY + k));
        if (!(_v.let_0)) {
            emit AssertionFailed("0: ");
            assert(false);
        }
    }

    function _original_Foo_main(uint k) private {
        x += k;
        y += k;
    }
}
/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}
