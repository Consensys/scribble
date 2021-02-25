pragma solidity 0.7.5;
contract Foo {
	/// if_succeeds let p := b in let t := a/p in t == c;
	function div(uint a, uint b) public pure returns (uint c) {
		return a/b;
	}
}
