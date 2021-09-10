pragma solidity 0.8.7;

contract AssertFunCall {
    uint t;
    
    function foo(uint x, uint y) public view returns (uint, uint) {
        return (x+t, y+t);    
    }
    
    function boo(uint a, uint b) public pure returns (uint) {
        return a + b;
    }

    function main(uint a, uint b, uint newT) public returns (uint) {
        t = newT;
        /// #assert let oldSum := a + b in let a, b := foo(a,b) in oldSum + 2*1 == a + b;
        boo(a,b);
    }
}