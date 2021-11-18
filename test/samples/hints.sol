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
}