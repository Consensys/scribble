pragma solidity 0.8.19;

library Foo {
	/// #if_succeeds $result == 1;
	function foo() internal returns (uint) {
		return 1;
	}
}

contract Boo {
	function main() public {
		Foo.foo();
	}
}