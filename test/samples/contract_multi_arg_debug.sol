pragma solidity 0.8.7;

/// #invariant {:msg ""} b == a + c - 1; 
contract Foo  {
    uint a=2;
    uint b=101;
    uint c=100;
    function inc5(uint x) external view returns (uint y) {
        return x+5;
    }
}
 
contract Base is Foo  {
    function inc3(uint x) external returns (uint y) {
        a += x + 1;
        return x+1;
    }
}


