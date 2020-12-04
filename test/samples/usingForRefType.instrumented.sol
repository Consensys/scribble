pragma solidity 0.6.12;

library Lib3 {
    function len(string memory s) public pure returns (uint) {
        return bytes(s).length;
    }
}

contract UsingForRefType {
    using Lib3 for string;

    event AssertionFailed(string message);

    string internal sS;

    function main(string memory mS) public {
        _original_UsingForRefType_main(mS);
        if ((!((sS.len() == mS.len())))) {
            emit AssertionFailed("0: F");
            assert(false);
        }
    }

    function _original_UsingForRefType_main(string memory mS) private {}
}
/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}
