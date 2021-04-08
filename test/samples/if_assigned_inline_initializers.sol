pragma solidity ^0.8.0;

contract Base {
	//// if_assigned x >= old(x);
	uint x = 1;
	//// if_updated arr.length > 0;
	//// if_assigned[x] 0 <= x && x <= arr.length;
	uint[] arr = [1];

	//// if_updated arr2.length > 0;
	//// if_assigned[x] 0 <= x && x <= arr2.length;
	//// if_assigned[x][y] 0 <= y && y <= arr2[x].length;
	uint[][] arr2 = [[1,2], [3,4]];

	struct S {
		uint[] arr;
		uint[][] arr2;
	}

	//// if_assigned s.arr.length > 0;
	//// if_assigned.arr[x] 0 <= x && x <= s.arr.length;
	//// if_assigned.arr2[x][y] 0 <= y && y <= s.arr2[x].length;
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
