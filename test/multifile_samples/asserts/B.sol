pragma solidity 0.8.7;
import "./A.sol";

/// #invariant sum < 200;
contract Base {
	/// #if_updated sum - old(sum) > X+1;
	uint sum;

	/// #if_succeeds n.length < 10;
	function main(uint[] memory n) public {
		/// #assert forall (uint i in n) n[i] <= 50; 
		for (uint i = 0; i < n.length; i++) {
			/// #assert n[i] > X;
			sum += n[i];
		}
	}
}