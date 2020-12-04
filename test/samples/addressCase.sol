pragma solidity ^0.6.0;
contract AddrChecker {
    /// if_succeeds {:msg "P1"} addr != address(0xAaaaAaAAaaaAAaAAaAaaaaAAAAAaAaaaAaAaaAA0);
    function checkAddr(address addr) external {
        require(addr != address(0xAaaaAaAAaaaAAaAAaAaaaaAAAAAaAaaaAaAaaAA0));
    }
}
