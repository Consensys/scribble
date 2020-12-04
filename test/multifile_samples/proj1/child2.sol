pragma solidity "0.6.11";
import {Base} from "./base.sol";
contract Child2 is Base {
    /// if_succeeds {:msg "P2"} x == 2* old(x);
    function double() public {
        x *= 2;
    }
    
}
