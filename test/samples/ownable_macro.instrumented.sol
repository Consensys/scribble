/// This file is auto-generated by Scribble and shouldn't be edited directly.
/// Use --disarm prior to make any changes.
pragma solidity 0.8.10;

///  #macro ownable(owner);
contract Ownable {
    event OwnershipTransferred(address indexed from, address indexed to);

    struct vars0 {
        address old_0;
    }

    address public owner;

    modifier onlyOwner() {
        require(owner == msg.sender, "Ownable: message sender is not the current owner");
        _;
    }

    constructor() {
        transferOwnership(msg.sender);
    }

    function transferOwnership(address to) virtual public onlyOwner() {
        address from = owner;
        Ownable_owner_address_assign(to);
        emit OwnershipTransferred(from, to);
    }

    function Ownable_owner_address_assign(address ARG0) internal returns (address RET0) {
        vars0 memory _v;
        unchecked {
            _v.old_0 = owner;
        }
        owner = ARG0;
        RET0 = owner;
        unchecked {
            if (!(_v.old_0 == msg.sender)) {
                emit __ScribbleUtilsLib__57.AssertionFailed("001042:0097:000 1: can only be updated by an owner");
                assert(false);
            }
        }
    }
}

library __ScribbleUtilsLib__57 {
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

contract Test is Ownable {}
