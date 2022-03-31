pragma solidity ^0.8.13;

import { X } from "./util.sol";

type Y is address;

function zerroAddr() returns (Y) {
    return Y.wrap(address(0x0));
}

function add(X a, X b) pure returns (uint256) {
    return 1;
}

contract Test {
    /// #if_succeeds true;
    function main() public returns (X) {
        X a = X.wrap(1);
        X b = X.wrap(2);

        return a.add(b);
    }
}
