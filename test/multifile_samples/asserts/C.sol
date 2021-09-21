pragma solidity 0.8.7;
import {X as XA} from "./A.sol";
import "./A.sol" as A;
import "./B.sol" as B;
import {X as XB} from "./B.sol";

contract Child is B.Base {
    function main1(uint t) public {
        /// #assert XA == 2 && XB == 2 && A.X == 2 && B.X == 2 && t == B.X;
        t++;

        A.Point memory p;
        p.x = 1;
        p.y = 2;
        /// #assert B.foo(p) == 3;
        t++;
    }
}