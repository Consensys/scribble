pragma solidity 0.7.5;

uint constant SOME = 10;

function addSome(uint v) pure returns (uint) {
    return v + SOME;
}

contract Test {
    uint num;

    /// if_succeeds {:msg "P1"} num == 25;
    function operate() public {
        num = addSome(15);
    }
}
