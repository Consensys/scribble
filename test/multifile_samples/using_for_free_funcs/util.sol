pragma solidity ^0.8.13;

type X is uint256;

function add(X a, X b) pure returns (X) {
    return X.wrap(X.unwrap(a) + X.unwrap(b));
}

using { add } for X global;
