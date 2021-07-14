pragma solidity 0.8.4;

contract Foo {
    event AssertionFailed(string message);

    struct vars0 {
        uint256 i0;
        uint256 k0;
        bool forall_0;
    }

    struct vars1 {
        uint256 i1;
        uint256 k1;
        bool forall_1;
    }

    struct vars2 {
        uint256 i2;
        int8 k2;
        bool forall_2;
    }

    uint256_to_uint256.S internal a;
    int8_to_uint256.S b0;

    function setA(uint key, uint val) public {
        vars0 memory _v;
        _original_Foo_setA(key, val);
        unchecked {
            _v.forall_0 = true;
            for (_v.i0 = 1; _v.i0 < a.keys.length; _v.i0++) {
                _v.k0 = a.keys[_v.i0];
                _v.forall_0 = uint256_to_uint256.get(a, _v.k0) > 1;
                if (!_v.forall_0) break;
            }
            if (!(_v.forall_0)) {
                emit AssertionFailed("0: ");
                assert(false);
            }
        }
    }

    function _original_Foo_setA(uint key, uint val) private {
        uint256_to_uint256.set(a, key, val);
    }

    function decA(uint key) public {
        vars1 memory _v;
        _original_Foo_decA(key);
        unchecked {
            _v.forall_1 = true;
            for (_v.i1 = 1; _v.i1 < a.keys.length; _v.i1++) {
                _v.k1 = a.keys[_v.i1];
                _v.forall_1 = uint256_to_uint256.get(a, _v.k1) > 1;
                if (!_v.forall_1) break;
            }
            if (!(_v.forall_1)) {
                emit AssertionFailed("1: ");
                assert(false);
            }
        }
    }

    function _original_Foo_decA(uint key) private {
        uint256_to_uint256.dec(a, key);
    }

    function setB(int8 key, uint val) public {
        vars2 memory _v;
        _original_Foo_setB(key, val);
        unchecked {
            _v.forall_2 = true;
            for (_v.i2 = 1; _v.i2 < b0.keys.length; _v.i2++) {
                _v.k2 = b0.keys[_v.i2];
                _v.forall_2 = int8_to_uint256.get(b0, _v.k2) > 2;
                if (!_v.forall_2) break;
            }
            if (!(_v.forall_2)) {
                emit AssertionFailed("2: ");
                assert(false);
            }
        }
    }

    function _original_Foo_setB(int8 key, uint val) private {
        int8_to_uint256.set(b0, key, val);
    }

    function b(int8 ARG_0) public returns (uint256 RET_0) {
        return int8_to_uint256.get(b0, ARG_0);
    }
}
/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}

library uint256_to_uint256 {
    struct S {
        mapping(uint256 => uint256) innerM;
        uint256[] keys;
        mapping(uint256 => uint256) keyIdxM;
    }

    function get(S storage m, uint256 key) internal returns (uint256) {
        return m.innerM[key];
    }

    function set(S storage m, uint256 key, uint256 val) internal returns (uint256) {
        m.innerM[key] = val;
        uint256 idx = m.keyIdxM[key];
        if (idx > 0) return m.innerM[key];
        if (m.keys.length == 0) {
            m.keys.push();
        }
        m.keyIdxM[key] = m.keys.length;
        m.keys.push(key);
        return m.innerM[key];
    }

    function deleteKey(S storage m, uint256 key) internal {
        delete m.innerM[key];
        uint256 idx = m.keyIdxM[key];
        if (idx == 0) return;
        if (idx != (m.keys.length - 1)) {
            uint256 lastKey = m.keys[m.keys.length - 1];
            m.keys[idx] = lastKey;
            m.keyIdxM[lastKey] = idx;
        }
        m.keys.pop();
        delete m.keyIdxM[key];
    }

    function inc_pre(S storage m, uint256 key) internal returns (uint256 RET) {
        return set(m, key, m.innerM[key] + 1);
    }

    function inc(S storage m, uint256 key) internal returns (uint256 RET) {
        RET = m.innerM[key];
        set(m, key, m.innerM[key] + 1);
    }

    function dec_pre(S storage m, uint256 key) internal returns (uint256 RET) {
        return set(m, key, m.innerM[key] - 1);
    }

    function dec(S storage m, uint256 key) internal returns (uint256 RET) {
        RET = m.innerM[key];
        set(m, key, m.innerM[key] - 1);
    }
}

library int8_to_uint256 {
    struct S {
        mapping(int8 => uint256) innerM;
        int8[] keys;
        mapping(int8 => uint256) keyIdxM;
    }

    function get(S storage m, int8 key) internal returns (uint256) {
        return m.innerM[key];
    }

    function set(S storage m, int8 key, uint256 val) internal returns (uint256) {
        m.innerM[key] = val;
        uint256 idx = m.keyIdxM[key];
        if (idx > 0) return m.innerM[key];
        if (m.keys.length == 0) {
            m.keys.push();
        }
        m.keyIdxM[key] = m.keys.length;
        m.keys.push(key);
        return m.innerM[key];
    }

    function deleteKey(S storage m, int8 key) internal {
        delete m.innerM[key];
        uint256 idx = m.keyIdxM[key];
        if (idx == 0) return;
        if (idx != (m.keys.length - 1)) {
            int8 lastKey = m.keys[m.keys.length - 1];
            m.keys[idx] = lastKey;
            m.keyIdxM[lastKey] = idx;
        }
        m.keys.pop();
        delete m.keyIdxM[key];
    }

    function inc_pre(S storage m, int8 key) internal returns (uint256 RET) {
        return set(m, key, m.innerM[key] + 1);
    }

    function inc(S storage m, int8 key) internal returns (uint256 RET) {
        RET = m.innerM[key];
        set(m, key, m.innerM[key] + 1);
    }

    function dec_pre(S storage m, int8 key) internal returns (uint256 RET) {
        return set(m, key, m.innerM[key] - 1);
    }

    function dec(S storage m, int8 key) internal returns (uint256 RET) {
        RET = m.innerM[key];
        set(m, key, m.innerM[key] - 1);
    }
}
