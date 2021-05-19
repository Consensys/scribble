pragma solidity 0.7.0;

/// #if_succeeds {:msg ""} b == a + 1; 
contract Foo  {
    uint a;
    uint b;

    function inc(uint x) public returns (uint y) {
        return x+1;
    }
    function inc2(uint x) virtual public returns(uint y){

    }
}

contract Bar is Foo  {
    function inc2(uint x) public override returns (uint y) {
        return x+3;
    }
    function inc3(uint x) public  pure returns (uint y) {
        return x+5;
    }

}
