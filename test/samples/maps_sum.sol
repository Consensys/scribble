pragma solidity 0.8.4;

contract Foo {
    // Simple map
    mapping(uint => uint) a;

    constructor() {
        a[0] = 10;
    }

    function get(uint k) public returns (uint) {
        return a[k];
    }

    /// #if_succeeds sum(a) > 10 && sum(a) < 20;
    function set(uint k, uint v) public {
        a[k] = v;
    }

    /// #if_succeeds sum(a) > 10 && sum(a) < 20;
    function inc(uint k) public {
        a[k]++;
    }

    /// #if_succeeds sum(a) > 10 && sum(a) < 20;
    function dec(uint k) public {
        a[k]--;
    }
}
