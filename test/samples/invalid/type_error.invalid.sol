contract Foo {
    /// @custom:scribble #if_succeeds x > y;
    function bar(uint x, int y) public {}
}
