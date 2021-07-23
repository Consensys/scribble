pragma solidity 0.8.4;

contract Base {
    // Simple map
    mapping(uint => uint) a;

    // Map with complex key
    mapping (string => int16) public c;

    string sS;

    // Nested map
    mapping (string => mapping(uint8 => int8)) d;

    // Map to array forall
    mapping (uint => uint[]) e;

    // Array of maps, array forall only
    mapping (uint => uint)[] f;

    // Array of maps, map forall only
    mapping (uint => uint)[] g;

    // Nested map first map only
    mapping (string => mapping(uint8 => int8)) h;

    // Nested map last map only
    mapping (string => mapping(uint8 => int8)) i;

    struct SA {
        mapping(string=>uint) m;
        uint cnt;
    }

    struct SB {
        SA[] sas;
    }

    SB j;
}
