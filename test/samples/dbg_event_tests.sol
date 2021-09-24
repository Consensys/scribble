pragma solidity 0.8.4;
contract Foo {
	/// #if_succeeds old(x) == 0;
	function changesArg1(uint x) public {
		x = 1;
	}

	/// #if_succeeds x == 0;
	function changesArg2(uint x) public {
		x = 1;
		// NOTE: For functions that modify the arguments, you still
		// always get the old value
	}

	uint[] x = [1,2];
	/// #if_succeeds old(x[0]) == 0;
	function changesArr1() public {
		x[0] = 3;
	}

	/// #if_succeeds x[0] == 0;
	function changesArr2() public {
		x[0] = 4;
	}

	/// #if_succeeds RET == 1;
	function newRet() public returns (uint RET) {
		return 2;
	}

	/// #if_succeeds let x := x+1 in let x := x+1 in let x := x+1 in x + x == 8;
	function shadowing(uint x) public {
	}

	uint t = 1;
	/// #if_updated arr[t] == 3;
	uint[] arr = [0,0,0,0];

	function updArr() public {
		arr[1] = 2;
	}

	/// #if_assigned[i] old(arr1[3]) == 3;
	uint[] arr1;

	constructor() {
		arr1 = [0,0,0,7];
	}

	function updArrOld() public {
		arr1[3] = 8;
	}

	/// #if_assigned[str] m[str].length > 1;
	/// #if_assigned[str][ind] m[str][ind] > 0;
	mapping(string => uint[]) m; 

	// Note that in the above annotations m will be skipped as its a map - not encodable :(
	function assignInd0() public {
		m["abc"] = [uint(1)];
	}

	function assignInd1() public {
		m["abc"] = [1,2,3];
		m["abc"][1] = 0;
	}
}
