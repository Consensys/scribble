pragma solidity 0.7.5;
contract Foo {
	uint x;
	uint y;

	function dbl() internal view returns (uint, uint) {
		return (x,y);
	}

	/// if_succeeds {:msg ""} let oldX,oldY := old(dbl()) in x == oldX + k && y == oldY + k;
	function main(uint k) public {
		x+=k;
		y+=k;
	}
}
