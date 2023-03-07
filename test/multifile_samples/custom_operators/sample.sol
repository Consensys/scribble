pragma solidity ^0.8.19;

import "./operators.sol";

contract Test {
    Custom a;
    Custom b;

    /// #if_succeeds true;
    function main() public {
        Custom a = Custom.wrap(1);
        Custom b = Custom.wrap(2);

        a + b;
        a - b;
        a == b;
    }
}
