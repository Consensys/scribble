pragma solidity ^0.8.0;

contract BadAliasing {
	//// #if_updated true;
	uint[] a;
	function main() public {
		uint[] storage p = a;
	}
}
