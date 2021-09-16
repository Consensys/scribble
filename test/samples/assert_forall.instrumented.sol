pragma solidity 0.8.7;

contract AssertForall {
    event AssertionFailed(string message);

    struct vars0 {
        uint256 i0;
        bool forall_0;
    }

    function main(uint[] memory n) public {
        vars0 memory _v;
        uint sum = 0;
        unchecked {
            _v.forall_0 = true;
            for (_v.i0 = 0; _v.i0 < n.length; _v.i0++) {
                _v.forall_0 = n[_v.i0] < 100;
                if (!_v.forall_0) break;
            }
            if (!(_v.forall_0)) {
                emit AssertionFailed("0: ");
                assert(false);
            }
        }
        for (uint i = 0; i < n.length; i++) {
            sum += n[i];
        }
    }
}

/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}
