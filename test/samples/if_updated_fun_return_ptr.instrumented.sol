/// This file is auto-generated by Scribble and shouldn't be edited directly.
/// Use --disarm prior to make any changes.
pragma solidity 0.4.26;

contract Foo {
    uint[] internal arr;
    int8[] internal arr1;

    function getPtr() internal returns (int8[] storage) {
        return arr1;
    }

    function main() public {
        getPtr().push(0);
        Foo_arr_uint256_push(1);
    }

    function Foo_arr_uint256_push(uint256 ARG0) internal {
        arr.push(ARG0);
        if (!(arr.length > 0)) {
            __ScribbleUtilsLib__33.assertionFailed("000523:0061:000 0: ");
            assert(false);
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
