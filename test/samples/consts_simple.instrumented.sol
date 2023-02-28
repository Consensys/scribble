/// This file is auto-generated by Scribble and shouldn't be edited directly.
/// Use --disarm prior to make any changes.
pragma solidity 0.8.18;

/// #const uint256 H := 60 * 60;
///  #const uint256 D := H * 24;
contract A {
    /// Definition of user constant const uint256 H := (60 * 60)
    uint256 internal H_7_0;
    /// Definition of user constant const uint256 D := (H * 24)
    uint256 internal D_7_0;

    function testHD() public {
        _original_A_testHD();
        unchecked {
            if (!(D_7_0 == (H_7_0 * 24))) {
                emit __ScribbleUtilsLib__23.AssertionFailed("000553:0066:000 2: ");
                assert(false);
            }
        }
    }

    function _original_A_testHD() private {}

    constructor() {
        /// Value assignment for const uint256 H := (60 * 60)
        H_7_0 = 60 * 60;
        /// Value assignment for const uint256 D := (H * 24)
        D_7_0 = H_7_0 * 24;
    }
}

/// #const uint256 H := 60 * 60;
///  #const uint256 D := H * 24;
///  #const uint256 W := D * 7;
contract B {
    /// Definition of user constant const uint256 H := (60 * 60)
    uint256 internal H_14_0;
    /// Definition of user constant const uint256 D := (H * 24)
    uint256 internal D_14_0;
    /// Definition of user constant const uint256 W := (D * 7)
    uint256 internal W_14_0;

    function testWHD() public {
        _original_B_testWHD();
        unchecked {
            if (!(((W_14_0 == (D_14_0 * 7)) && (D_14_0 == (H_14_0 * 24))) && (H_14_0 == (60 * 60)))) {
                emit __ScribbleUtilsLib__23.AssertionFailed("001527:0066:000 6: ");
                assert(false);
            }
        }
    }

    function _original_B_testWHD() private {}

    constructor() {
        /// Value assignment for const uint256 H := (60 * 60)
        H_14_0 = 60 * 60;
        /// Value assignment for const uint256 D := (H * 24)
        D_14_0 = H_14_0 * 24;
        /// Value assignment for const uint256 W := (D * 7)
        W_14_0 = D_14_0 * 7;
    }
}

library __ScribbleUtilsLib__23 {
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

contract C is B {
    constructor() {
        _original_C_constructor();
        unchecked {
            if (!(W_14_0 == (D_14_0 * 7))) {
                emit __ScribbleUtilsLib__23.AssertionFailed("002893:0066:000 7: ");
                assert(false);
            }
        }
    }

    function _original_C_constructor() private {}
}
