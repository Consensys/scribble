pragma solidity 0.8.19;

contract Target {
    function foo(uint x) public pure {}

    function foo(uint x, uint y) public payable {}
}

/// #invariant true;
contract Caller {

    function main(Target t) public {
        t.foo(1);

        t.foo(2, 3);
    }
}
