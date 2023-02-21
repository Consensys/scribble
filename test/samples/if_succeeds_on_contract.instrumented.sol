/// This file is auto-generated by Scribble and shouldn't be edited directly.
/// Use --disarm prior to make any changes.
pragma solidity 0.7.0;

/// #if_succeeds {:msg ""} b == a + old(1);
///  #if_succeeds {:msg ""} b == a&1; 
contract Foo {
    uint internal a;
    uint internal b;

    function inc(uint x) public returns (uint y) {
        y = _original_Foo_inc(x);
        if (!(b == (a ^ 1))) {
            emit __ScribbleUtilsLib__69.AssertionFailed("2: ");
            assert(false);
        }
        if (!(b == (a + 1))) {
            emit __ScribbleUtilsLib__69.AssertionFailed("0: ");
            assert(false);
        }
        if (!(b == (a & 1))) {
            emit __ScribbleUtilsLib__69.AssertionFailed("1: ");
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

library __ScribbleUtilsLib__69 {
    event AssertionFailed(string message);

    event AssertionFailedData(int eventId, bytes encodingData);

    function assertionFailed(string memory arg_0) internal {
        emit AssertionFailed(arg_0);
    }

    function assertionFailedData(int arg_0, bytes memory arg_1) internal {
        emit AssertionFailedData(arg_0, arg_1);
    }

    function isInContract() internal returns (bool res) {
        assembly {
            res := sload(0x5f0b92cf9616afdee4f4136f66393f1343b027f01be893fa569eb2e2b667a40c)
        }
    }

    function setInContract(bool v) internal {
        assembly {
            sstore(0x5f0b92cf9616afdee4f4136f66393f1343b027f01be893fa569eb2e2b667a40c, v)
        }
    }
}
