pragma solidity "0.7.5";
import "./imp3.sol";

contract Goo {
	//Foo s1; Foo is not in scope
	//Bar s2; Bar is not in scope
	Boo s3;
	I2.Bar s4;
	I1.Foo s5;
}
