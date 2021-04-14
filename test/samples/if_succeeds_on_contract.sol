pragma solidity 0.7.0;


/// if_succeeds {:msg ""} b == a + 1; 
/// if_succeeds {:msg ""} b == a&1; 
contract Foo  {
    uint a;
    uint b;
    /// if_succeeds {:msg ""} b == a^1; 
    function inc(uint x) public pure returns (uint y) {
        return x+1;
    }
}
