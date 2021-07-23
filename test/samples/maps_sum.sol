pragma solidity 0.8.4;

contract Foo {
    // Simple map
    mapping(uint => uint) a;

    constructor() {
        a[0] = 10;
        b[0] = 127;
    }

    function getA(uint k) public returns (uint) {
        return a[k];
    }

    /// #if_succeeds unchecked_sum(a) > 10 && unchecked_sum(a) < 20;
    function setA(uint k, uint v) public {
        a[k] = v;
    }

    /// #if_succeeds unchecked_sum(a) > 10 && unchecked_sum(a) < 20;
    function incA(uint k) public {
        a[k]++;
    }

    /// #if_succeeds unchecked_sum(a) > 10 && unchecked_sum(a) < 20;
    function decA(uint k) public {
        a[k]--;
    }

    // Different base type
    mapping (uint => int8) b;

    /// #if_succeeds unchecked_sum(b) > 128;
    function setB(uint k, int8 v) public {
        b[k] = v;
    }

    /// #if_succeeds unchecked_sum(b) > 128;
    function decB(uint k) public {
        --b[k];
    }

    /// #if_succceeds unchecked_sum(b) == -256;
    function negB() public {
        b[0] = -128;
        b[1] = -128;
    }

    /// #if_succceeds unchecked_sum(b) == -1;
    function underflowB0() public {
        unchecked {
            b[0]--;
        }
    }

    /// #if_succceeds unchecked_sum(b) == 254;
    function underflowB1() public {
        unchecked {
            b[1]--;
        }
    }


    /// #if_succceeds unchecked_sum(b) == -1;
    function overflowB0() public {
        unchecked {
            b[0]++;
        }
    }

    /// #if_succceeds unchecked_sum(b) == -256;
    function overflowB1() public {
        unchecked {
            b[1]++;
        }
    }

    // nested map
    mapping(string => mapping (uint => int16)) c;

    /// #if_succeeds forall (string memory x in c) unchecked_sum(c[x]) > 0;
    function setC(string memory k1, uint k2, int16 v) public {
        c[k1][k2] = v;
    }

    /// #if_succeeds forall (string memory x in c) unchecked_sum(c[x]) > 0;
    function decC(string memory k1, uint k2) public {
        unchecked {
            c[k1][k2]--;
        }
    }

    /// #if_succeeds forall (string memory x in c) unchecked_sum(c[x]) > 0;
    function incC(string memory k1, uint k2) public {
        unchecked {
            c[k1][k2]++;
        }
        
    }
}
