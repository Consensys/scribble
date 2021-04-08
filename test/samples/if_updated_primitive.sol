pragma solidity ^0.8.0;

contract Base {
	//// if_updated x >=1;
	uint x = 1;
	//// if_updated y >= old(y);
	uint y = 2;

	uint z;

	//// if_updated t == 0;
	uint t;

	//// if_updated uint160(a) >= 1;
	address a = address(0x1);

	uint[] arr;
	constructor() {
		x = 2;
		a = address(0x2);
	}

	function id(uint z) internal returns (uint) {
		return z;
	}

	function main() public {
		x++;

		for (x = 5; x < 10; x++) y++;

		x = x = 5;

		x = id(x = 6);
		
		delete t;
		
		y = y + 1;
		
		x = x++;
		assert(x == 6);
		
		x = ++x;
		assert(x == 7);

		arr.push(1);

		arr.push(2);
	}
}


contract Child is Base {
	function moo() public {
		x = 1;
	}
}
