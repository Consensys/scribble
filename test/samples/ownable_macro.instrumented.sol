pragma solidity 0.8.7;

///  macro ownable(owner);
contract Ownable {
    event OwnershipTransferred(address indexed from, address indexed to);

    event AssertionFailed(string message);

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
                emit AssertionFailed("1: can only be updated by an owner");
                assert(false);
            }
        }
    }
}

/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}

contract Test is Ownable {}
