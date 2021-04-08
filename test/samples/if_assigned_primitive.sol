pragma solidity ^0.8.0;

contract Base {
	//// if_assigned x >=1;
	uint x = 1;
	//// if_assigned y >= old(y);
	uint y = 2;

	uint z;

	//// if_assigned uint160(a) >= 1;
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
		assert(x == 3);
		for (x = 5; x < 10; x++) y++;
		assert(x == 10 && y == 7);

		x = x = 5;
		assert(x == 6);

		x = id(x = 6);
		assert(x == 7);
		
		delete x;
		assert(x == 0);
		
		y = y + 1;
		assert(y == 8);
		
		x = x++;
		assert(x == 0);
		
		x = ++x;
		assert(x == 1);

		arr.push(1);

		arr.push(2);
	}
}


contract Child is Base {
	function moo() public {
		x = 1;
	}
}
