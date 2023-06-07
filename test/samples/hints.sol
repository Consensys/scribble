pragma solidity 0.8.10;
/// #require z > 1;
/// #try msg.sender == address(0x0); 
contract Foo {
    uint z;
    

    /// #require x > 2;
    /// #try x < 10;
    function bar(uint x) public {

        /// #require x > 10;
        /// #try x == 9;
        uint z = x + 1;
    }

    function boo() public {}

    function baz() internal {}

    /// #try x == 1, y == 2;
    function test(uint x, uint y) public returns (uint) {
        uint a = 1;
        uint b = 2;
        /// #try a == 1, b == 2;
        return x + y + z + a + b;
    }
}
