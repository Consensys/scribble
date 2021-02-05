pragma solidity "0.5.0";
import "./imp3.sol";
import "./imp3.sol" as I3;

contract Goo is I11.Foo {
	//Foo s1; Foo is not in scope
	//Bar s2; Bar is not in scope
	Boo s3;
	I2.Bar s4;
	I11.Foo s5;

	function baz() public pure returns (uint) {
		return I11.Foo.foo();
	}

	function main() public {
		Boo x = new Boo();
		I2.Bar y = new I2.Bar();
		I11.Foo z = new I11.Foo();

		I3.Moo w = new I3.Moo();

		function() pure returns (uint) f = I11.Foo.foo;
		uint t = I11.Foo.x;
		uint t1 = Boo.x;
	}
}
