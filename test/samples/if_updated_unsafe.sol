pragma solidity 0.8.3;

contract TestUnchecked {
    //// if_assigned {:msg "A1"} x > 0;
    //// if_updated {:msg "U1"} x > 0;
    uint8 x = 100;

    /// if_succeeds {:msg "S1"} x == 1;
    function foo() public {
        x = 255;

        unchecked {
            x += 2;
        }
    }
}
