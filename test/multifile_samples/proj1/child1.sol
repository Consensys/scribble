pragma solidity "0.6.11";
import {Base} from "./base.sol";
contract Child1 is Base {
    /// #if_succeeds {:msg "P1"} x == old(x) + y;
    function add(uint y) public {
        x += y;
    }
}
