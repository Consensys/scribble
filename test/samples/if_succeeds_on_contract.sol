pragma solidity 0.7.0;


/// #if_succeeds {:msg ""} b == a + old(1);
/// #if_succeeds {:msg ""} b == a&1; 
contract Foo  {
    uint a;
    uint b;
    /// #if_succeeds {:msg ""} b == a^1; 
    function inc(uint x) public view returns (uint y) {
        return x+1;
    }
    
    function inc2(uint x) external view returns (uint y) {
        return x+1;
    }

    function inc3(uint x) private view returns (uint y) {
        return x+1;
    }

    function inc4(uint x) internal view returns (uint y) {
        return x+1;
    }

    function inc5(uint x) public pure returns (uint y) {
	return x+2;
    }
}
