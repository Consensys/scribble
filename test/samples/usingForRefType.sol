pragma solidity 0.6.12;
library Lib3 {
    function len(string memory s) public pure returns (uint) {
        return bytes(s).length;
    }
}

contract UsingForRefType {
    using Lib3 for string;
    string sS;
    
    /// if_succeeds {:msg "F"} sS.len() == mS.len();
    function main(string memory mS) public {
    }
}
