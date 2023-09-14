pragma solidity 0.8.11;

contract LetAnnotation {
	function foo(uint amount) public {
		uint[] memory a;
		for(uint i = 0; i < a.length; i++) {
			/// #let oldVal := a[i];
			a[i] += amount;
			/// #assert oldVal > 0;
			0;
		}
	}

	function foo1(uint amount) public {
			uint[] memory a;
			for(uint i = 0; i < a.length; i++) {
					/// #let oldVal := a[i];
					/// #assert oldVal > 0;
					a[i] += amount;
					0;
			}
	}

	function foo2(uint amount) public {
		uint[] memory a;
		/// #let oldVal := a[0];
		for(uint i = 0; i < a.length; i++) {
				/// #assert oldVal > 0;
				a[i] += amount;
		}
	}

	/// #if_succeeds let y := bytes1(0xf) in y > 0x1;
    function foo3() public {}
}

// ---------------------------------------------

contract Foo {
    function snd(uint v) internal pure returns (uint, uint) {
        return (1,v);
    }

    /// #if_succeeds {:msg "P0"} let _,x := snd(v) in x == 2;
    function foo(uint v) public {
    }
}
