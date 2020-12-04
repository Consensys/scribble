pragma solidity 0.6.8;
/// invariant {:msg "P1"} true;
contract Test {
    function foo(bytes calldata x) external returns (uint) {
        return x.length;
    }
}
