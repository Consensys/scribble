/// This file is auto-generated by Scribble and shouldn't be edited directly.
/// Use --disarm prior to make any changes.
pragma solidity 0.8.8;

enum A { A, B, C }

type Price is uint32;

interface IFace {
    function foo() external;
}

contract Boo {
    function foo() external {}
}

contract UserDefinedValueTypes {
    type Quantity is uint32;

    function main(uint32 a, int64 b, A c) public {
        _original_UserDefinedValueTypes_main(a, b, c);
        unchecked {
            if (!((a >= type(uint32).min) && (a <= type(uint32).max))) {
                __ScribbleUtilsLib__32.assertionFailed("0: ");
                assert(false);
            }
            if (!((b >= type(int64).min) && (b <= type(int64).max))) {
                __ScribbleUtilsLib__32.assertionFailed("1: ");
                assert(false);
            }
            if (!((c != type(A).min) && (c != type(A).max))) {
                __ScribbleUtilsLib__32.assertionFailed("2: ");
                assert(false);
            }
            if (!(keccak256(bytes(type(IFace).name)) == keccak256(bytes("IFace")))) {
                __ScribbleUtilsLib__32.assertionFailed("3: ");
                assert(false);
            }
            if (!(keccak256(type(Boo).creationCode) == bytes32(0x0))) {
                __ScribbleUtilsLib__32.assertionFailed("4: ");
                assert(false);
            }
            if (!(keccak256(type(Boo).runtimeCode) == bytes32(0x0))) {
                __ScribbleUtilsLib__32.assertionFailed("5: ");
                assert(false);
            }
            if (!(type(IFace).interfaceId != bytes4(0x0))) {
                __ScribbleUtilsLib__32.assertionFailed("6: ");
                assert(false);
            }
        }
    }

    function _original_UserDefinedValueTypes_main(uint32 a, int64 b, A c) private {}
}

library __ScribbleUtilsLib__32 {
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
