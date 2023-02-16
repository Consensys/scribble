/// This file is auto-generated by Scribble and shouldn't be edited directly.
/// Use --disarm prior to make any changes.
pragma solidity 0.8.10;

contract AssertForall {
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
                __ScribbleUtilsLib__33.assertionFailed("0: ");
                assert(false);
            }
        }
        for (uint i = 0; i < n.length; i++) {
            sum += n[i];
        }
    }
}

library __ScribbleUtilsLib__33 {
    event AssertionFailed(string message);

    event AssertionFailedData(int eventId, bytes encodingData);

    function assertionFailed(string memory arg_0) internal {
        emit AssertionFailed(arg_0);
    }

    function assertionFailedData(int arg_0, bytes memory arg_1) internal {
        emit AssertionFailedData(arg_0, arg_1);
    }
}

/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    event AssertionFailed(string message);

    event AssertionFailedData(int eventId, bytes encodingData);

    bool __scribble_out_of_contract = true;
}
