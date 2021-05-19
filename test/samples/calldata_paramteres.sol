pragma solidity 0.6.10;
/// #invariant {:msg "P1"} true;
contract Test {
    function foo(bytes calldata x) external returns (bytes calldata y) {
        y = x;
    }

    function moo() public {
        bytes memory m = "abc";
        bytes memory n = this.foo(m);

        assert(n[0] == "a");
        assert(n[1] == "b");
        assert(n[2] == "c");
    }
}
