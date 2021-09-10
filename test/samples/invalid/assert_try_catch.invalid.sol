pragma solidity 0.8.7;

contract Foo {
	function main(uint n) public {
		try this.main(0) {

		} /** #assert true; */ catch Error(string memory errmsg) {

		}
	}
}
