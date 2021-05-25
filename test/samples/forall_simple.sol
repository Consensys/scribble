pragma solidity 0.8.4;

/// #invariant forall (uint i in a) a[i] > 10;
contract ForallSimple {
	uint[] a;
	function push(uint x) external {
		a.push(x);
	}

	/// #if_succeeds forall (uint i in a) let z1 := x in let z2 := a[i] in z2 > z1;
	function test1(uint[] memory a, uint x) public {
	}

	uint t = 0;
	/// #if_succeeds forall (uint i in a) a[i] > old(t);
	function test2(uint[] memory a, uint x) public {
		t = x;
	}

	uint t1 = 0;
	/// #if_succeeds old(forall (uint i in a) let x := a[i] in let y := t1 in x > y);
	function test3(uint[] memory a, uint x) public {
		t1 = x;
	}

	uint t2 = 0;
	/// #if_succeeds forall (uint i in a) forall (uint j in a[i]) a[i][j] > old(t2);
	function test4(uint[][] memory a, uint x) public {
		t2 = x;
	}

	/// #if_succeeds forall (uint i in 1...5) i >= 1 && i < 5;
	function test5() public {
	}

	/// #if_succeeds forall (uint i in 1...5) i > 1;
	function test6() public {
	}

	/// #if_succeeds forall (uint i in 1...5) i < 4;
	function test7() public {
	}

	/// #if_succeeds forall (uint i in 5...5) false;
	function test11() public {
	}

	/// #if_succeeds let MAX_INT := uint(2**255 - 1 + 2**255) in forall (uint i in MAX_INT...MAX_INT) false;
	function test12() public {
	}
}
