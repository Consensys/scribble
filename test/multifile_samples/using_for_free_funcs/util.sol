pragma solidity ^0.8.13;

type X is uint256;
type Y is bool;

function not(Y x) returns (Y) {
    return Y.wrap(!Y.unwrap(x));
}

function add(X a, X b) pure returns (X) {
    return X.wrap(X.unwrap(a) + X.unwrap(b));
}

using { add } for X global;
