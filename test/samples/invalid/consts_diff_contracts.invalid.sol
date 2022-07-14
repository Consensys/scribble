/// #const uint256 H := 60 * 60;
/// #const uint256 D := H * 24;
contract A {
    /// #if_succeeds D == H * 24;
    function testHD() public {}
}

/// #const uint256 W := D * 7;
contract B {
    /// #if_succeeds W == D * 7 && D == H * 24 && H == 60 * 60;
    function testWHD() public {}
}

contract C is B {
    /// #if_succeeds old(W) == D * 7;
    constructor() {}
}
