pragma solidity ^0.8.0;

abstract contract Base {
	constructor(uint[] storage s) {
		
	}
}

contract BadAliasing is Base {
	//// #if_updated true;
	uint[] a;
	
	constructor() Base(a) {}
}
