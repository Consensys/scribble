contract Foo {
    uint z;

    /// #require old(x) < 10;
    function bar(uint x) public {
        uint z = x + 1;
    }
}
