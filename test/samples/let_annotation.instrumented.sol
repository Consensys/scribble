/// This file is auto-generated by Scribble and shouldn't be edited directly.
/// Use --disarm prior to make any changes.
pragma solidity 0.8.11;

contract LetAnnotation {
    struct vars0 {
        uint256 oldVal;
    }

    struct vars1 {
        uint256 oldVal1;
    }

    struct vars2 {
        uint256 oldVal2;
    }

    function foo(uint amount) public {
        vars0 memory _v;
        uint[] memory a;
        for (uint i = 0; i < a.length; i++) {
            unchecked {
                _v.oldVal = a[i];
            }
            a[i] += amount;
            unchecked {
                if (!(_v.oldVal > 0)) {
                    __ScribbleUtilsLib__100.assertionFailed("1: ");
                    assert(false);
                }
            }
            0;
        }
    }

    function foo1(uint amount) public {
        vars1 memory _v;
        uint[] memory a;
        for (uint i = 0; i < a.length; i++) {
            unchecked {
                _v.oldVal1 = a[i];
                if (!(_v.oldVal1 > 0)) {
                    __ScribbleUtilsLib__100.assertionFailed("3: ");
                    assert(false);
                }
            }
            a[i] += amount;
            0;
        }
    }

    function foo2(uint amount) public {
        vars2 memory _v;
        uint[] memory a;
        unchecked {
            _v.oldVal2 = a[0];
        }
        for (uint i = 0; i < a.length; i++) {
            unchecked {
                if (!(_v.oldVal2 > 0)) {
                    __ScribbleUtilsLib__100.assertionFailed("5: ");
                    assert(false);
                }
            }
            a[i] += amount;
        }
    }
}

library __ScribbleUtilsLib__100 {
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
