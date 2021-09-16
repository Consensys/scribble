pragma solidity 0.8.7;

contract A {
    uint public a;
    constructor(uint _a) { require(_a >= 0); a = _a; }
}

/// #invariant a > 0;
contract B is A {
    constructor() A(1) {}
}

