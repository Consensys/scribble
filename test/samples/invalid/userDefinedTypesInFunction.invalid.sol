/// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

/**
 * #define isPolicyValid(Policy policy) bool = policy.exptime > 0 && policy.vfee > 0;
 */
contract Feature181 {
    struct Policy {
        bytes32 dn;
        uint exptime;
        uint vfee;
    }
}
