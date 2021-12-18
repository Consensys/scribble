// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

/**
 * #macro ownable(owner1);
 */
contract Ownable {
    address public owner;

    event OwnershipTransferred(address indexed from, address indexed to);

    constructor() {
        transferOwnership(msg.sender);
    }

    modifier onlyOwner() {
        require(owner == msg.sender, "Ownable: message sender is not the current owner");

        _;
    }

    function transferOwnership(address to) public virtual onlyOwner {
        address from = owner;

        owner = to;

        emit OwnershipTransferred(from, to);
    }
}

contract Test is Ownable {}
