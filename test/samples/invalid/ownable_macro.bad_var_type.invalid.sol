// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

/**
 * #macro ownable(owner);
 */
contract Ownable {
    uint public owner;

    function main() public {
        owner = 1;
    }
}

contract Test is Ownable {}
