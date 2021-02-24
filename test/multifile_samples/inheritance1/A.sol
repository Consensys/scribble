contract A {

    /// if_succeeds $result >= x;
    function foo(uint x) public virtual returns (uint) {
        return x+1;
    }
}
