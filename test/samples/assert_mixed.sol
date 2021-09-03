pragma solidity 0.8.7;
/// #invariant sum < 200;
contract AssertMixed {
	/// #if_updated sum - old(sum) > 3;
	uint sum;

	/// #if_succeeds n.length < 10;
	function main(uint[] memory n) public {
		/// #assert forall (uint i in n) n[i] <= 50; 
		for (uint i = 0; i < n.length; i++) {
			/// #assert n[i] > 2;
			sum += n[i];
		}
	}
}
