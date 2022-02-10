pragma solidity ^0.8.4;

contract RevertStmt {
	error E();
	/// #if_succeeds false;
	function foo() public {
		revert E();
	}
}
