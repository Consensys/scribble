pragma solidity 0.8.10;
contract Foo {
	function main(uint n) public {
		uint sum = 0;
		for (uint i = 0; i < n; /** #assert true; */ i++) {
			sum += i;
		}
	}
}
