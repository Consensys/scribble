pragma solidity ^0.8.19;

type Custom is uint256;

function plus(Custom a, Custom b) pure returns (Custom) {
    return Custom.wrap(Custom.unwrap(a) + Custom.unwrap(b));
}

function diff(Custom a, Custom b) pure returns (Custom) {
    return Custom.wrap(Custom.unwrap(a) - Custom.unwrap(b));
}

function eq(Custom a, Custom b) pure returns (bool) {
    return Custom.unwrap(a) == Custom.unwrap(b);
}

using { plus as +, diff as -, eq as == } for Custom global;
