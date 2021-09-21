pragma solidity 0.7.5;

/// #define plus(uint x) uint = z + x;
///  #define plus2(uint Foo) uint = z + Foo;
///  #define plus3(uint plus2) uint = z + plus2;
///  #define double(uint z) uint = z+z;
///  #define quad(uint z) uint = let res := z+z in res + res;
///  #define quad2(uint z) uint = double(double(z));
contract Foo {
    struct vars4 {
        uint256 res;
        uint256 let_0;
    }

    uint internal z;

    /// Implementation of user function define plus(uint256 x) uint256 = (z + x)
    function plus(uint256 x) internal view returns (uint256) {
        return z + x;
    }

    /// Implementation of user function define plus2(uint256 Foo) uint256 = (z + Foo)
    function plus2(uint256 Foo1) internal view returns (uint256) {
        return z + Foo1;
    }

    /// Implementation of user function define plus3(uint256 plus2) uint256 = (z + plus2)
    function plus3(uint256 plus21) internal view returns (uint256) {
        return z + plus21;
    }

    /// Implementation of user function define double(uint256 z) uint256 = (z + z)
    function double(uint256 z1) internal view returns (uint256) {
        return z1 + z1;
    }

    /// Implementation of user function define quad(uint256 z) uint256 = (let res := (z + z) in (res + res))
    function quad(uint256 z2) internal view returns (uint256) {
        vars4 memory _v;
        _v.res = z2 + z2;
        _v.let_0 = _v.res + _v.res;
        return _v.let_0;
    }

    /// Implementation of user function define quad2(uint256 z) uint256 = double(double(z))
    function quad2(uint256 z3) internal view returns (uint256) {
        return double(double(z3));
    }
}

/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}
