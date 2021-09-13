pragma solidity ^0.5.0;

contract PointerSwap {
	//// #if_updated true;
	uint[] a = [1,2,3];
	uint[] b = [4,5,6];

	function main() public {
		(a, b) = (b, a);

		assert(a[0] == 4 && b[0] == 1);
	}
}
