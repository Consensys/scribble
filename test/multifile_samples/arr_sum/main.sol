pragma solidity 0.8.4;

contract Foo {
    // Simple map
    uint[] a = [10];
    int8[] b;

    /// #if_succeeds unchecked_sum(a) > 10 && unchecked_sum(a) < 20;
    function pushA(uint k) public {
        a.push(k);
    }

    /// #if_succeeds unchecked_sum(a) > 10 && unchecked_sum(a) < 20;
    function setA(uint k, uint v) public {
        a[k] = v;
    }

    /// #if_succeeds unchecked_sum(b) > -10 && unchecked_sum(b) < 10;
    function pushB(int8 k) public {
        b.push(k);
    }

    /// #if_succeeds unchecked_sum(b) > -10 && unchecked_sum(b) < 10;
    function setB(uint k, int8 v) public {
        b[k] = v;
    }
    

    /// #if_succeeds unchecked_sum(c) > -10 && unchecked_sum(c) < 10;
    function memArr(int16[] memory c) public {
    }

    /// #if_succeeds unchecked_sum(c) > -10 && unchecked_sum(c) < 10;
    function calldataArr(int16[] calldata c) external {
    }

    /// #if_succeeds unchecked_sum(c) < 10;
    function overflowCheck(uint[] calldata c) external {
    }
}
