pragma solidity 0.8.11;
contract IfSucceedsOnStatement {
	function foo(uint amount) public {
		uint[] memory a;
		for(uint i = 0; i < a.length; i++) {
			/// #if_succeeds old(a[i]) + amount == a[i];
			a[i] += amount;
		}
	}

	function boo(uint amount) public {
		uint[] memory a;
		for(uint i = 0; i < a.length; i++)
		/// #if_succeeds old(a[i]) + amount == a[i];
		{
			
			a[i] += amount;
		}
	}
}
