pragma solidity 0.8.4;

contract Foo {
    mapping(uint => uint) a;
    mapping(int8 => uint) public b;
    
    /// #if_succeeds forall(uint k in a) a[k] > 1;
    function setA(uint key, uint val) public {
        a[key] = val;
    }

    /// #if_succeeds forall(uint k in a) a[k] > 1;
    function decA(uint key) public {
        a[key]--;
    }

    /// #if_succeeds forall(int8 k in b) b[k] > 2;
    function setB(int8 key, uint val) public {
        b[key] = val;
    }
}
