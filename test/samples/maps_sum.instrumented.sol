pragma solidity 0.8.4;

contract Foo {
    event AssertionFailed(string message);

    struct vars5 {
        uint256 i0;
        string x0;
        bool forall_0;
    }

    struct vars6 {
        uint256 i1;
        string x1;
        bool forall_1;
    }

    struct vars7 {
        uint256 i2;
        string x2;
        bool forall_2;
    }

    uint256_to_uint256.S internal a;
    uint256_to_int8.S internal b;
    string_to_uint256_to_int16_S_234.S internal c;

    constructor() {
        uint256_to_uint256.set(a, 0, 10);
        uint256_to_int8.set(b, 0, 127);
    }

    function getA(uint k) public returns (uint) {
        return uint256_to_uint256.get(a, k);
    }

    function setA(uint k, uint v) public {
        _original_Foo_setA(k, v);
        unchecked {
            if (!((a.sum > 10) && (a.sum < 20))) {
                emit AssertionFailed("0: ");
                assert(false);
            }
        }
    }

    function _original_Foo_setA(uint k, uint v) private {
        uint256_to_uint256.set(a, k, v);
    }

    function incA(uint k) public {
        _original_Foo_incA(k);
        unchecked {
            if (!((a.sum > 10) && (a.sum < 20))) {
                emit AssertionFailed("1: ");
                assert(false);
            }
        }
    }

    function _original_Foo_incA(uint k) private {
        uint256_to_uint256.inc(a, k);
    }

    function decA(uint k) public {
        _original_Foo_decA(k);
        unchecked {
            if (!((a.sum > 10) && (a.sum < 20))) {
                emit AssertionFailed("2: ");
                assert(false);
            }
        }
    }

    function _original_Foo_decA(uint k) private {
        uint256_to_uint256.dec(a, k);
    }

    function setB(uint k, int8 v) public {
        _original_Foo_setB(k, v);
        unchecked {
            if (!(b.sum > 128)) {
                emit AssertionFailed("3: ");
                assert(false);
            }
        }
    }

    function _original_Foo_setB(uint k, int8 v) private {
        uint256_to_int8.set(b, k, v);
    }

    function decB(uint k) public {
        _original_Foo_decB(k);
        unchecked {
            if (!(b.sum > 128)) {
                emit AssertionFailed("4: ");
                assert(false);
            }
        }
    }

    function _original_Foo_decB(uint k) private {
        uint256_to_int8.dec_pre(b, k);
    }

    /// #if_succceeds unchecked_sum(b) == -256;
    function negB() public {
        uint256_to_int8.set(b, 0, -128);
        uint256_to_int8.set(b, 1, -128);
    }

    /// #if_succceeds unchecked_sum(b) == -1;
    function underflowB0() public {
        unchecked {
            uint256_to_int8.dec_unch(b, 0);
        }
    }

    /// #if_succceeds unchecked_sum(b) == 254;
    function underflowB1() public {
        unchecked {
            uint256_to_int8.dec_unch(b, 1);
        }
    }

    /// #if_succceeds unchecked_sum(b) == -1;
    function overflowB0() public {
        unchecked {
            uint256_to_int8.inc_unch(b, 0);
        }
    }

    /// #if_succceeds unchecked_sum(b) == -256;
    function overflowB1() public {
        unchecked {
            uint256_to_int8.inc_unch(b, 1);
        }
    }

    function setC(string memory k1, uint k2, int16 v) public {
        vars5 memory _v;
        _original_Foo_setC(k1, k2, v);
        unchecked {
            _v.forall_0 = true;
            for (_v.i0 = 1; _v.i0 < c.keys.length; _v.i0++) {
                _v.x0 = c.keys[_v.i0];
                _v.forall_0 = string_to_uint256_to_int16_S_234.get(c, _v.x0).sum > 0;
                if (!_v.forall_0) break;
            }
            if (!(_v.forall_0)) {
                emit AssertionFailed("5: ");
                assert(false);
            }
        }
    }

    function _original_Foo_setC(string memory k1, uint k2, int16 v) private {
        uint256_to_int16.set(string_to_uint256_to_int16_S_234.get_lhs(c, k1), k2, v);
    }

    function decC(string memory k1, uint k2) public {
        vars6 memory _v;
        _original_Foo_decC(k1, k2);
        unchecked {
            _v.forall_1 = true;
            for (_v.i1 = 1; _v.i1 < c.keys.length; _v.i1++) {
                _v.x1 = c.keys[_v.i1];
                _v.forall_1 = string_to_uint256_to_int16_S_234.get(c, _v.x1).sum > 0;
                if (!_v.forall_1) break;
            }
            if (!(_v.forall_1)) {
                emit AssertionFailed("6: ");
                assert(false);
            }
        }
    }

    function _original_Foo_decC(string memory k1, uint k2) private {
        unchecked {
            uint256_to_int16.dec_unch(string_to_uint256_to_int16_S_234.get_lhs(c, k1), k2);
        }
    }

    function incC(string memory k1, uint k2) public {
        vars7 memory _v;
        _original_Foo_incC(k1, k2);
        unchecked {
            _v.forall_2 = true;
            for (_v.i2 = 1; _v.i2 < c.keys.length; _v.i2++) {
                _v.x2 = c.keys[_v.i2];
                _v.forall_2 = string_to_uint256_to_int16_S_234.get(c, _v.x2).sum > 0;
                if (!_v.forall_2) break;
            }
            if (!(_v.forall_2)) {
                emit AssertionFailed("7: ");
                assert(false);
            }
        }
    }

    function _original_Foo_incC(string memory k1, uint k2) private {
        unchecked {
            uint256_to_int16.inc_unch(string_to_uint256_to_int16_S_234.get_lhs(c, k1), k2);
        }
    }
}

/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}

library uint256_to_int16 {
    struct S {
        mapping(uint256 => int16) innerM;
        uint256[] keys;
        mapping(uint256 => uint256) keyIdxM;
        int256 sum;
    }

    function addKey(S storage m, uint256 key) private {
        uint idx = m.keyIdxM[key];
        if (idx == 0) {
            if (m.keys.length == 0) {
                m.keys.push();
            }
            m.keyIdxM[key] = m.keys.length;
            m.keys.push(key);
        }
    }

    function removeKey(S storage m, uint256 key) private {
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

    function set(S storage m, uint256 key, int16 val) internal returns (int16) {
        unchecked {
            m.sum -= m.innerM[key];
            m.sum += val;
        }
        m.innerM[key] = val;
        addKey(m, key);
        return m.innerM[key];
    }

    function dec_unch(S storage m, uint256 key) internal returns (int16 RET) {
        unchecked {
            RET = m.innerM[key];
            set(m, key, m.innerM[key] - 1);
        }
    }

    function inc_unch(S storage m, uint256 key) internal returns (int16 RET) {
        unchecked {
            RET = m.innerM[key];
            set(m, key, m.innerM[key] + 1);
        }
    }
}

library uint256_to_uint256 {
    struct S {
        mapping(uint256 => uint256) innerM;
        uint256[] keys;
        mapping(uint256 => uint256) keyIdxM;
        uint256 sum;
    }

    function addKey(S storage m, uint256 key) private {
        uint idx = m.keyIdxM[key];
        if (idx == 0) {
            if (m.keys.length == 0) {
                m.keys.push();
            }
            m.keyIdxM[key] = m.keys.length;
            m.keys.push(key);
        }
    }

    function removeKey(S storage m, uint256 key) private {
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

    function set(S storage m, uint256 key, uint256 val) internal returns (uint256) {
        unchecked {
            m.sum -= m.innerM[key];
            m.sum += val;
        }
        m.innerM[key] = val;
        addKey(m, key);
        return m.innerM[key];
    }

    function inc(S storage m, uint256 key) internal returns (uint256 RET) {
        RET = m.innerM[key];
        set(m, key, m.innerM[key] + 1);
    }

    function dec(S storage m, uint256 key) internal returns (uint256 RET) {
        RET = m.innerM[key];
        set(m, key, m.innerM[key] - 1);
    }

    function get(S storage m, uint256 key) internal view returns (uint256) {
        return m.innerM[key];
    }
}

library uint256_to_int8 {
    struct S {
        mapping(uint256 => int8) innerM;
        uint256[] keys;
        mapping(uint256 => uint256) keyIdxM;
        int256 sum;
    }

    function addKey(S storage m, uint256 key) private {
        uint idx = m.keyIdxM[key];
        if (idx == 0) {
            if (m.keys.length == 0) {
                m.keys.push();
            }
            m.keyIdxM[key] = m.keys.length;
            m.keys.push(key);
        }
    }

    function removeKey(S storage m, uint256 key) private {
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

    function set(S storage m, uint256 key, int8 val) internal returns (int8) {
        unchecked {
            m.sum -= m.innerM[key];
            m.sum += val;
        }
        m.innerM[key] = val;
        addKey(m, key);
        return m.innerM[key];
    }

    function dec_pre(S storage m, uint256 key) internal returns (int8 RET) {
        return set(m, key, m.innerM[key] - 1);
    }

    function dec_unch(S storage m, uint256 key) internal returns (int8 RET) {
        unchecked {
            RET = m.innerM[key];
            set(m, key, m.innerM[key] - 1);
        }
    }

    function inc_unch(S storage m, uint256 key) internal returns (int8 RET) {
        unchecked {
            RET = m.innerM[key];
            set(m, key, m.innerM[key] + 1);
        }
    }
}

library string_to_uint256_to_int16_S_234 {
    struct S {
        mapping(string => uint256_to_int16.S) innerM;
        string[] keys;
        mapping(string => uint256) keyIdxM;
    }

    function addKey(S storage m, string memory key) private {
        uint idx = m.keyIdxM[key];
        if (idx == 0) {
            if (m.keys.length == 0) {
                m.keys.push();
            }
            m.keyIdxM[key] = m.keys.length;
            m.keys.push(key);
        }
    }

    function removeKey(S storage m, string memory key) private {
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

    function get_lhs(S storage m, string memory key) internal returns (uint256_to_int16.S storage) {
        addKey(m, key);
        return m.innerM[key];
    }

    function get(S storage m, string memory key) internal view returns (uint256_to_int16.S storage) {
        return m.innerM[key];
    }
}
