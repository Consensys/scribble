pragma solidity ^0.8.0;

contract PushRef {
	//// if_updated true;
	uint[] a;
	function main() public {
		a.push() = 1;
	}
}
