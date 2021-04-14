pragma solidity ^0.5.0;

contract PointerTupleAssignment05 {
	//// if_updated true;
	uint[] a;
	uint[] b;

	function main() public {
		(a, b) = (b, a);
	}
}
