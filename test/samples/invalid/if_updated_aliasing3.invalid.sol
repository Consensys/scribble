pragma solidity ^0.8.0;

contract BadAliasing {
	//// #if_updated true;
	uint[] a1;
	uint[] a2;
	uint[] a3;
	function main(bool flag1, bool flag2) public {
		(uint[] storage p, uint x) = flag1 ? (a2, 1) : flag2 ? (a3, 2) : (a1, 3);
	}
}
