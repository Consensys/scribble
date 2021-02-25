pragma solidity 0.6.12;

contract AddrChecker {
    event AssertionFailed(string message);

    function checkAddr(address addr) external {
        _original_AddrChecker_checkAddr(addr);
        if (!(addr != address(0xAaaaAaAAaaaAAaAAaAaaaaAAAAAaAaaaAaAaaAA0))) {
            emit AssertionFailed("0: P1");
            assert(false);
        }
    }

    function _original_AddrChecker_checkAddr(address addr) private {
        require(addr != address(0xAaaaAaAAaaaAAaAAaAaaaaAAAAAaAaaaAaAaaAA0));
    }
}
/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}
