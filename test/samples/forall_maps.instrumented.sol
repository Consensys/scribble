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
        string s0;
        bool forall_2;
    }

    struct vars3 {
        uint256 i3;
        string s1;
        bool forall_3;
        uint256 i4;
        uint8 k2;
        bool forall_4;
    }

    struct vars4 {
        uint256 i5;
        uint256 k3;
        bool forall_5;
    }

    uint256_to_uint256.S internal a;
    string_to_int16.S c0;
    string internal sS;
    string_to_uint8_to_int8_S_108.S internal d;
    uint256_to_uint256_arr.S internal e;

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

    function setC(string memory s, int16 v) public {
        vars2 memory _v;
        _original_Foo_setC(s, v);
        unchecked {
            _v.forall_2 = true;
            for (_v.i2 = 1; _v.i2 < c0.keys.length; _v.i2++) {
                _v.s0 = c0.keys[_v.i2];
                _v.forall_2 = string_to_int16.get(c0, _v.s0) > (-1);
                if (!_v.forall_2) break;
            }
            if (!(_v.forall_2)) {
                emit AssertionFailed("2: ");
                assert(false);
            }
        }
    }

    function _original_Foo_setC(string memory s, int16 v) private {
        string_to_int16.set(c0, s, v);
    }

    function setD(string memory s, uint8 k, int8 v) public {
        vars3 memory _v;
        _original_Foo_setD(s, k, v);
        unchecked {
            _v.forall_3 = true;
            for (_v.i3 = 1; _v.i3 < d.keys.length; _v.i3++) {
                _v.s1 = d.keys[_v.i3];
                _v.forall_4 = true;
                for (_v.i4 = 1; _v.i4 < string_to_uint8_to_int8_S_108.get(d, _v.s1).keys.length; _v.i4++) {
                    _v.k2 = string_to_uint8_to_int8_S_108.get(d, _v.s1).keys[_v.i4];
                    _v.forall_4 = uint8_to_int8.get(string_to_uint8_to_int8_S_108.get(d, _v.s1), _v.k2) > 0;
                    if (!_v.forall_4) break;
                }
                _v.forall_3 = _v.forall_4;
                if (!_v.forall_3) break;
            }
            if (!(_v.forall_3)) {
                emit AssertionFailed("3: ");
                assert(false);
            }
        }
    }

    function _original_Foo_setD(string memory s, uint8 k, int8 v) private {
        uint8_to_int8.set(string_to_uint8_to_int8_S_108.get_lhs(d, s), k, v);
    }

    function setE(uint k, uint[] memory v) public {
        vars4 memory _v;
        _original_Foo_setE(k, v);
        unchecked {
            _v.forall_5 = true;
            for (_v.i5 = 1; _v.i5 < e.keys.length; _v.i5++) {
                _v.k3 = e.keys[_v.i5];
                _v.forall_5 = uint256_to_uint256_arr.get(e, _v.k3).length > 0;
                if (!_v.forall_5) break;
            }
            if (!(_v.forall_5)) {
                emit AssertionFailed("4: ");
                assert(false);
            }
        }
    }

    function _original_Foo_setE(uint k, uint[] memory v) private {
        uint256_to_uint256_arr.set(e, k, v);
    }

    function c(string memory ARG_0) public returns (int16 RET_0) {
        return string_to_int16.get(c0, ARG_0);
    }
}
/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}

library uint8_to_int8 {
    struct S {
        mapping(uint8 => int8) innerM;
        uint8[] keys;
        mapping(uint8 => uint256) keyIdxM;
    }

    function get_lhs(S storage m, uint8 key) internal returns (int8) {
        uint idx = m.keyIdxM[key];
        if (idx == 0) {
            if (m.keys.length == 0) {
                m.keys.push();
            }
            m.keyIdxM[key] = m.keys.length;
            m.keys.push(key);
        }
        return m.innerM[key];
    }

    function get(S storage m, uint8 key) internal returns (int8) {
        return m.innerM[key];
    }

    function set(S storage m, uint8 key, int8 val) internal returns (int8) {
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

    function deleteKey(S storage m, uint8 key) internal {
        delete m.innerM[key];
        uint256 idx = m.keyIdxM[key];
        if (idx == 0) return;
        if (idx != (m.keys.length - 1)) {
            uint8 lastKey = m.keys[m.keys.length - 1];
            m.keys[idx] = lastKey;
            m.keyIdxM[lastKey] = idx;
        }
        m.keys.pop();
        delete m.keyIdxM[key];
    }

    function inc_pre(S storage m, uint8 key) internal returns (int8 RET) {
        return set(m, key, m.innerM[key] + 1);
    }

    function inc(S storage m, uint8 key) internal returns (int8 RET) {
        RET = m.innerM[key];
        set(m, key, m.innerM[key] + 1);
    }

    function dec_pre(S storage m, uint8 key) internal returns (int8 RET) {
        return set(m, key, m.innerM[key] - 1);
    }

    function dec(S storage m, uint8 key) internal returns (int8 RET) {
        RET = m.innerM[key];
        set(m, key, m.innerM[key] - 1);
    }
}

library uint256_to_uint256 {
    struct S {
        mapping(uint256 => uint256) innerM;
        uint256[] keys;
        mapping(uint256 => uint256) keyIdxM;
    }

    function get_lhs(S storage m, uint256 key) internal returns (uint256) {
        uint idx = m.keyIdxM[key];
        if (idx == 0) {
            if (m.keys.length == 0) {
                m.keys.push();
            }
            m.keyIdxM[key] = m.keys.length;
            m.keys.push(key);
        }
        return m.innerM[key];
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

library string_to_int16 {
    struct S {
        mapping(string => int16) innerM;
        string[] keys;
        mapping(string => uint256) keyIdxM;
    }

    function get_lhs(S storage m, string memory key) internal returns (int16) {
        uint idx = m.keyIdxM[key];
        if (idx == 0) {
            if (m.keys.length == 0) {
                m.keys.push();
            }
            m.keyIdxM[key] = m.keys.length;
            m.keys.push(key);
        }
        return m.innerM[key];
    }

    function get(S storage m, string memory key) internal returns (int16) {
        return m.innerM[key];
    }

    function set(S storage m, string memory key, int16 val) internal returns (int16) {
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

    function deleteKey(S storage m, string memory key) internal {
        delete m.innerM[key];
        uint256 idx = m.keyIdxM[key];
        if (idx == 0) return;
        if (idx != (m.keys.length - 1)) {
            string storage lastKey = m.keys[m.keys.length - 1];
            m.keys[idx] = lastKey;
            m.keyIdxM[lastKey] = idx;
        }
        m.keys.pop();
        delete m.keyIdxM[key];
    }

    function inc_pre(S storage m, string memory key) internal returns (int16 RET) {
        return set(m, key, m.innerM[key] + 1);
    }

    function inc(S storage m, string memory key) internal returns (int16 RET) {
        RET = m.innerM[key];
        set(m, key, m.innerM[key] + 1);
    }

    function dec_pre(S storage m, string memory key) internal returns (int16 RET) {
        return set(m, key, m.innerM[key] - 1);
    }

    function dec(S storage m, string memory key) internal returns (int16 RET) {
        RET = m.innerM[key];
        set(m, key, m.innerM[key] - 1);
    }
}

library string_to_uint8_to_int8_S_108 {
    struct S {
        mapping(string => uint8_to_int8.S) innerM;
        string[] keys;
        mapping(string => uint256) keyIdxM;
    }

    function get_lhs(S storage m, string memory key) internal returns (uint8_to_int8.S storage) {
        uint idx = m.keyIdxM[key];
        if (idx == 0) {
            if (m.keys.length == 0) {
                m.keys.push();
            }
            m.keyIdxM[key] = m.keys.length;
            m.keys.push(key);
        }
        return m.innerM[key];
    }

    function get(S storage m, string memory key) internal returns (uint8_to_int8.S storage) {
        return m.innerM[key];
    }
}

library uint256_to_uint256_arr {
    struct S {
        mapping(uint256 => uint256[]) innerM;
        uint256[] keys;
        mapping(uint256 => uint256) keyIdxM;
    }

    function get_lhs(S storage m, uint256 key) internal returns (uint256[] storage) {
        uint idx = m.keyIdxM[key];
        if (idx == 0) {
            if (m.keys.length == 0) {
                m.keys.push();
            }
            m.keyIdxM[key] = m.keys.length;
            m.keys.push(key);
        }
        return m.innerM[key];
    }

    function get(S storage m, uint256 key) internal returns (uint256[] storage) {
        return m.innerM[key];
    }

    function set(S storage m, uint256 key, uint256[] memory val) internal returns (uint256[] storage) {
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
}
