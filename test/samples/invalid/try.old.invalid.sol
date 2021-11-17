contract Foo {
    uint z;
    

    /// #try old(x) < 10;
    function bar(uint x) public {
        uint z = x + 1;
    }
}
