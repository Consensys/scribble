pragma solidity 0.8.10;
contract AssertForall {
	function main(uint[] memory n) public {
		uint sum = 0;
		/// #assert forall (uint i in n) n[i] < 100; 
		for (uint i = 0; i < n.length; i++) {
			sum += n[i];
		}
	}
}
