pragma solidity 0.8.20;
/// #const uint256 H := 60 * 60;
/// #const uint256 D := H * 24;
contract A {
    /// #if_succeeds D == H * 24;
    function testHD() public {}
}

/// #const uint256 H := 60 * 60;
/// #const uint256 D := H * 24;
/// #const uint256 W := D * 7;
contract B {
    /// #if_succeeds W == D * 7 && D == H * 24 && H == 60 * 60;
    function testWHD() public {}
}

contract C is B {
    /// #if_succeeds old(W) == D * 7;
    constructor() {}
}

// --------------------------------------------

/// #define plus(uint x) uint = z + x;
/// #define plus2(uint Foo) uint = z + Foo;
/// #define plus3(uint plus2) uint = z + plus2;
/// #define double(uint z) uint = z+z;
/// #define quad(uint z) uint = let res := z+z in res + res;
/// #define quad2(uint z) uint = double(double(z));
contract UserDefinedFunctions {
	uint z;
}

// --------------------------------------------

contract EqEncoded {
    struct Some {
        uint a;
    }

    enum Other {
        A, B
    }

    uint256[3] a = [1, 2, 3];
    uint256[3] b = [1, 2, 3];
    uint256[3] c = a;

    uint256[] d = [4, 5, 6];
    uint256[] e = [4, 5, 6];
    uint256[] f = a;

    Some s = Some(1);

    /// #if_succeeds eq_encoded("abc", hex"616263");
    /// #if_succeeds eq_encoded(bytes2(0xffcc), bytes2(0xffcc));
    /// #if_succeeds eq_encoded(0xC0FfEec0ffeeC0FfEec0fFEec0FfeEc0fFEe0000, 0xC0FfEec0ffeeC0FfEec0fFEec0FfeEc0fFEe0000);
    /// #if_succeeds eq_encoded(uint256(512), uint16(512));
    /// #if_succeeds eq_encoded(int256(-512), int256(-512));
    /// #if_succeeds eq_encoded(true, true);
    /// #if_succeeds eq_encoded(false, false);
    /// #if_succeeds eq_encoded(Some(1), s);
    /// #if_succeeds eq_encoded(Other.A, Other.A);
    /// #if_succeeds eq_encoded(a, b);
    /// #if_succeeds eq_encoded(d, e);
    function positive() public returns (bool) {
        return true;
    }

    /// #if_succeeds !eq_encoded("abc", "abcd");
    /// #if_succeeds !eq_encoded("abc", "def");
    /// #if_succeeds !eq_encoded(hex"616263", hex"616264");
    /// #if_succeeds !eq_encoded(bytes2(0xffcc), bytes2(0xffff));
    /// #if_succeeds !eq_encoded(0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF, 0xC0FfEec0ffeeC0FfEec0fFEec0FfeEc0fFEe0000);
    /// #if_succeeds !eq_encoded(uint256(512), uint16(1024));
    /// #if_succeeds !eq_encoded(int256(-512), int256(-1024));
    /// #if_succeeds !eq_encoded(true, false);
    /// #if_succeeds !eq_encoded(Some(2), s);
    /// #if_succeeds !eq_encoded(Other.A, Other.B);
    /// #if_succeeds !eq_encoded(a, d);
    /// #if_succeeds !eq_encoded(c, f);
    function negative() public returns (bool) {
        return true;
    }
}
