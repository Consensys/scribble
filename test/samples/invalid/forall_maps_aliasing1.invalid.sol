pragma solidity ^0.8.0;

contract BadAliasing {
	mapping(uint => uint) a;
	/// #if_succeeds forall (uint x in a) a[x] > 0;
	function main() public {
		mapping(uint => uint) storage p = a;
	}
}
