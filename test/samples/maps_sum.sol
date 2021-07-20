pragma solidity 0.8.4;

contract Foo {
    // Simple map
    mapping(uint => uint) a;

    constructor() {
        a[0] = 10;
    }

    /// #if_succeeds sum(a) > 10 && sum(a) < 20;
    function set(uint k, uint v) public {
        a[k] = v;
    }
}
