contract Foo {
	/// #if_updated forall(uint k in m) m[k][0] > 1;
        mapping(uint=>mapping(uint => uint)) m;

	function main() public {
		m[0][1] = 1;
	}
}
