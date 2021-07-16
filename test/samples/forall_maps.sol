pragma solidity 0.8.4;

contract Foo {
    // Simple map
    mapping(uint => uint) a;
    
    /// #if_succeeds forall(uint k in a) a[k] > 1;
    function setA(uint key, uint val) public {
        a[key] = val;
    }

    /// #if_succeeds forall(uint k in a) a[k] > 1;
    function decA(uint key) public {
        a[key]--;
    }

    // Map with complex key
    mapping (string => int16) public c;

    string sS;

    /// #if_succeeds forall (string memory s in c) c[s] > -1;
    function setC(string memory s, int16 v) public {
        c[s] = v;
    }

    // Nested map
    mapping (string => mapping(uint8 => int8)) d;

    /// #if_succeeds forall (string memory s in d) forall (uint8 k in d[s]) d[s][k] > 0;
    function setD(string memory s, uint8 k, int8 v) public {
        d[s][k] = v;
    }

    // Map to array forall
    mapping (uint => uint[]) e;
    /// #if_succeeds forall (uint k in e) e[k].length > 0;
    function setE(uint k, uint[] memory v) public {
        e[k] = v;
    }
}
