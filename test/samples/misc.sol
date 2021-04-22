pragma solidity ^0.6.0;

// ---------------------------------------------

contract AddrChecker {
    /// if_succeeds {:msg "P1"} addr != address(0xAaaaAaAAaaaAAaAAaAaaaaAAAAAaAaaaAaAaaAA0);
    function checkAddr(address addr) external {
        require(addr != address(0xAaaaAaAAaaaAAaAAaAaaaaAAAAAaAaaaAaAaaAA0));
    }
}

// ---------------------------------------------

contract MapIdx {
    mapping(string => int) a;

    /// if_succeeds {:msg "F"} a[arg] == 0;
    function main(string memory arg) public {}
}

// ---------------------------------------------

contract MemoryCast {
    uint256[] _nums;

    /// if_succeeds {:msg "P1"} _isEvenLen(_nums);
    function entry() external {
        require(_isEvenLen(_nums));
        _nums.push();
    }

    function _isEvenLen(uint256[] memory arr) internal view returns (bool) {
        return arr.length % 2 == 0;
    }
}

// ---------------------------------------------

contract OldInOld {
    uint t;
    /// if_succeeds {:msg ""} let oldTT := old(t) in let oldT := oldTT in let oldTTimes2 := old(oldT * 2) in oldTTimes2 == t;
    function moo() public  {
        t = t *2;
    }
}

// ---------------------------------------------

contract OldTuple {
	uint x;
	uint y;

	function dbl() internal view returns (uint, uint) {
		return (x,y);
	}

	/// if_succeeds {:msg ""} let oldX,oldY := old(dbl()) in x == oldX + k && y == oldY + k;
	function main(uint k) public {
		x+=k;
		y+=k;
	}
}

// ---------------------------------------------

contract Result {
    /// if_succeeds {:msg ""} $result == 1;
    function a() public returns (uint) {
        return 1;
    }

    /// if_succeeds {:msg ""} $result == x;
    /// if_succeeds {:msg ""} let t := $result in t == x;
    function b() public returns (uint x) {
        x = 2;
    }

    /// if_succeeds {:msg ""} let a,b := $result in a == 1 && b == 2 && t == b;
    function d() public returns (uint, uint t) {
        return (1,2);
    }
}

// ---------------------------------------------

library Lib3 {
    function len(string memory s) public pure returns (uint) {
        return bytes(s).length;
    }
}

contract UsingForRefType {
    using Lib3 for string;
    string sS;

    /// if_succeeds {:msg "F"} sS.len() == mS.len();
    function main(string memory mS) public {}
}

// ---------------------------------------------

contract ExternalCall {

    /// if_succeeds {:msg "wrong byte"} checkBytes(_bytes) == result;
    function process(bytes calldata _bytes) external returns (bool result) {
        return this.checkBytes(_bytes);
    }

    function checkBytes(bytes calldata _bytes) pure external returns (bool result) {
        return _bytes.length > 0;
    }
}
/// define some stuff
/// define some(other stuff
contract IgnoreNonFunDefines {
    
}
