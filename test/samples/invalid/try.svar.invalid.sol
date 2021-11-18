contract Foo {
    /// #try z>1;
    uint z;

    function bar(uint x) public {
        uint z = x + 1;
    }
}
