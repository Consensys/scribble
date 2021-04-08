pragma solidity ^0.8.0;

contract Base {
	//// if_updated x >= old(x);
	uint x = 1;
	//// if_updated arr.length > 0;
	uint[] arr = [1];

	//// if_updated arr2.length > 0;
	uint[][] arr2 = [[1,2], [3,4]];

	struct S {
		uint[] arr;
		uint[][] arr2;
	}

	//// if_updated s.arr.length > 0;
	S s = S({arr:arr, arr2: arr2});
}

contract Child is Base {
	constructor() public {
		x = 4;
		arr = [4];
		arr2 = [[1], [2]];
		s.arr = arr;
		s.arr2 = arr2;
	}
}
