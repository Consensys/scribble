pragma solidity ^0.8.0;

contract BadAliasing {
	struct S {
		mapping(uint => uint) a;
		mapping(uint => uint) b;
	}

	S s;
	/// #if_succeeds forall (uint x in s.a) s.a[x] > 0;
	function main() public {
		mapping(uint => uint) storage p = s.b;
	}
}
