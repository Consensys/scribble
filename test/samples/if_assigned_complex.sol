pragma solidity 0.8.7;

contract Base {
	//// #if_assigned x >= old(x);
	uint x;
	//// #if_updated arr.length > 0;
	//// #if_assigned[x] 0 <= x && x <= arr.length;
	uint[] arr;

	//// #if_updated arr2.length > 0;
	//// #if_assigned[x] 0 <= x && x <= arr2.length;
	//// #if_assigned[x][y] 0 <= y && y <= arr2[x].length;
	uint[][] arr2;

	struct S {
		uint[] arr;
		uint[][] arr2;
	}

	//// #if_assigned.arr[x] 0 <= x && x <= s.arr.length;
	//// #if_assigned.arr2[x][y] 0 <= y && y <= s.arr2[x].length;
	S s;

	constructor() {
		x = 1;
	}

	function main() public {
		arr.push(1);
		arr.push(2);
		arr[0] = 3;
		assert(arr[0] == 3 && arr[1] == 2);
		
		(arr[0], arr[1]) = (5, (6)); 
		
		assert(arr[0] == 5 && arr[1] == 6);

		arr2.push(arr);
		arr2[0][1] = 7;
		
		assert(arr2[0][0] == 5 && arr2[0][1] == 7);

		arr2[0] = arr;

        assert(arr2[0][0] == 5 && arr2[0][1] == 6);
		s.arr.push(10);
		s.arr.push(11);
		assert(s.arr.length == 2 && s.arr[0] == 10 && s.arr[1] == 11);
		s.arr[0] = 12;
		s.arr[1] = 13;
		
		assert(s.arr.length == 2 && s.arr[0] == 12 && s.arr[1] == 13);

		s.arr2.push(s.arr);
		
		assert(s.arr2.length == 1 && s.arr2[0][0] == 12 && s.arr2[0][1] == 13);
		s.arr2[0] = s.arr;
		s.arr2[0][1] = 14;
		assert(s.arr2[0][1] == 14);
	}
}


contract Child is Base {
	function moo() public {
		arr[0] = 10;
	}
}
