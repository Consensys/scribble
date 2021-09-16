pragma solidity 0.8.7;

contract IfUpdatedPrimitive {
	//// #if_updated x >=1;
	uint x = 1;
	uint y = 2;

	//// #if_updated uint160(a) >= 1;
	address a = address(0x1);

	constructor() {
		x = 2;
		a = address(0x2);
	}

	function getTwo() internal returns (uint, address) {
		return (4, address(0x4));
	}

	function id(uint z) internal returns (uint) {
		return z;
	}

	function main() public {
		(x, a) = (x+1, address(uint160(a)+1));	
		assert(x == 3 && a == address(0x3));
		(x, y) = (y, x);
		assert(x == 2 && y == 3);

		(x, a) = getTwo();
		assert(x == 4);
		
		x = 1;

		// Should be disallowed
		// (y, (x, y)) = (1, getTwo());

        (y, (x, a)) = (1, getTwo());
        assert(y == 1 && x == 4);

		(x,y) = y == 1 ? (3, 4) : (5,6);
		assert(x == 3 && y == 4);

		(x,y) = (x == 0) ? (0, 0) : (x == 3) ? (1, 1) : (0, 0);

		assert(x == 1 && y == 1);
	}
}
