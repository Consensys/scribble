pragma solidity ^0.7.0;

import {SOME as OTHER, addSome as addOther} from "./A.sol";
import "./A.sol" as A;
import "./B.sol" as B;
import {A as X} from "./B.sol";

contract Test {
    uint num = A.SOME;

    /// if_succeeds {:msg "P1"} num == 35;
    function one() public {
        num = addOther(15 + OTHER);
    }

    /// if_succeeds {:msg "P2"} num == 35;
    function two() public {
        num = A.addSome(15 + A.SOME);
    }

    /// if_succeeds {:msg "P3"} num == 35;
    function three() public {
        num = B.A.addSome(15 + B.A.SOME);
    }

    /// if_succeeds {:msg "P4"} num == 35;
    function four() public {
        num = X.addSome(15 + X.SOME);
    }
}
