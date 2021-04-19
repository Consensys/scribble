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

contract MapIdx {
    event AssertionFailed(string message);

    mapping(string => int) internal a;

    function main(string memory arg) public {
        _original_MapIdx_main(arg);
        if (!(a[arg] == 0)) {
            emit AssertionFailed("1: F");
            assert(false);
        }
    }

    function _original_MapIdx_main(string memory arg) private {}
}

contract MemoryCast {
    event AssertionFailed(string message);

    uint256[] internal _nums;

    function entry() external {
        _original_MemoryCast_entry();
        if (!(_isEvenLen(_nums))) {
            emit AssertionFailed("2: P1");
            assert(false);
        }
    }

    function _original_MemoryCast_entry() private {
        require(_isEvenLen(_nums));
        _nums.push();
    }

    function _isEvenLen(uint256[] memory arr) internal view returns (bool) {
        return (arr.length % 2) == 0;
    }
}

contract OldInOld {
    event AssertionFailed(string message);

    struct vars3 {
        uint256 old_0;
        uint256 oldTT;
        uint256 oldT;
        uint256 old_1;
        uint256 oldTTimes2;
        bool let_0;
        bool let_1;
        bool let_2;
    }

    uint internal t;

    function moo() public {
        vars3 memory _v;
        _v.old_0 = t;
        _v.oldTT = _v.old_0;
        _v.oldT = _v.oldTT;
        _v.old_1 = _v.oldT * 2;
        _v.oldTTimes2 = _v.old_1;
        _original_OldInOld_moo();
        _v.let_0 = _v.oldTTimes2 == t;
        _v.let_1 = _v.let_0;
        _v.let_2 = _v.let_1;
        if (!(_v.let_2)) {
            emit AssertionFailed("3: ");
            assert(false);
        }
    }

    function _original_OldInOld_moo() private {
        t = t * 2;
    }
}

contract OldTuple {
    event AssertionFailed(string message);

    struct vars4 {
        uint256 oldX;
        uint256 oldY;
        bool let_3;
    }

    uint internal x;
    uint internal y;

    function dbl() internal view returns (uint, uint) {
        return (x, y);
    }

    function main(uint k) public {
        vars4 memory _v;
        (_v.oldX, _v.oldY) = dbl();
        _original_OldTuple_main(k);
        _v.let_3 = (x == (_v.oldX + k)) && (y == (_v.oldY + k));
        if (!(_v.let_3)) {
            emit AssertionFailed("4: ");
            assert(false);
        }
    }

    function _original_OldTuple_main(uint k) private {
        x += k;
        y += k;
    }
}

contract Result {
    event AssertionFailed(string message);

    struct vars6 {
        uint256 t1;
        bool let_4;
    }

    struct vars7 {
        uint256 a1;
        uint256 b1;
        bool let_5;
    }

    function a() public returns (uint RET_0) {
        RET_0 = _original_Result_a();
        if (!(RET_0 == 1)) {
            emit AssertionFailed("5: ");
            assert(false);
        }
    }

    function _original_Result_a() private returns (uint) {
        return 1;
    }

    function b() public returns (uint x) {
        vars6 memory _v;
        x = _original_Result_b();
        _v.t1 = x;
        _v.let_4 = _v.t1 == x;
        if (!(x == x)) {
            emit AssertionFailed("6: ");
            assert(false);
        }
        if (!(_v.let_4)) {
            emit AssertionFailed("7: ");
            assert(false);
        }
    }

    function _original_Result_b() private returns (uint x) {
        x = 2;
    }

    function d() public returns (uint RET_0, uint t) {
        vars7 memory _v;
        (RET_0, t) = _original_Result_d();
        _v.a1 = RET_0;
        _v.b1 = t;
        _v.let_5 = ((_v.a1 == 1) && (_v.b1 == 2)) && (t == _v.b1);
        if (!(_v.let_5)) {
            emit AssertionFailed("8: ");
            assert(false);
        }
    }

    function _original_Result_d() private returns (uint, uint t) {
        return (1, 2);
    }
}

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
        if (!(sS.len() == mS.len())) {
            emit AssertionFailed("9: F");
            assert(false);
        }
    }

    function _original_UsingForRefType_main(string memory mS) private {}
}

contract ExternalCall {
    event AssertionFailed(string message);

    function process(bytes calldata _bytes) external returns (bool result) {
        result = _original_ExternalCall_process(_bytes);
        if (!(this.checkBytes(_bytes) == result)) {
            emit AssertionFailed("10: wrong byte");
            assert(false);
        }
    }

    function _original_ExternalCall_process(bytes calldata _bytes) private returns (bool result) {
        return this.checkBytes(_bytes);
    }

    function checkBytes(bytes calldata _bytes) external pure returns (bool result) {
        return _bytes.length > 0;
    }
}

/// define some stuff
///  define some(other stuff
contract IgnoreNonFunDefines {}
/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}
