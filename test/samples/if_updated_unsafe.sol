pragma solidity 0.8.3;

/// define id(uint x) uint = x + 1 - 1;
contract TestUnchecked {
    //// if_assigned {:msg "A1"} id(x) > 0;
    //// if_updated {:msg "U1"} x > 0;
    uint8 x = 100;

    /// if_succeeds {:msg "S1"} x == 1;
    function foo() public {
        x = 254;

        x += 1;

        unchecked {
            x += 2;
        }
    }
}
