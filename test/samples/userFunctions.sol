pragma solidity 0.7.5;
/// #define plus(uint x) uint = z + x;
/// #define plus2(uint Foo) uint = z + Foo;
/// #define plus3(uint plus2) uint = z + plus2;
/// #define double(uint z) uint = z+z;
/// #define quad(uint z) uint = let res := z+z in res + res;
/// #define quad2(uint z) uint = double(double(z));
contract Foo {
	uint z;
}
