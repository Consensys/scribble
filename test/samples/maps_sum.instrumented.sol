pragma solidity 0.8.4;

/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
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

    function get_lhs(S storage m, uint256 key) internal returns (uint256) {
        addKey(m, key);
        return m.innerM[key];
    }

    function get(S storage m, uint256 key) internal returns (uint256) {
        return m.innerM[key];
    }

    function set(S storage m, uint256 key, uint256 val) internal returns (uint256) {
        m.sum += val;
        m.sum -= m.innerM[key];
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
        m.sum -= m.innerM[key];
        delete m.innerM[key];
        removeKey(m, key);
    }

    function inc_pre(S storage m, uint256 key) internal returns (uint256 RET) {
        return set(m, key, m.innerM[key] + 1);
        m.sum++;
    }

    function inc(S storage m, uint256 key) internal returns (uint256 RET) {
        RET = m.innerM[key];
        set(m, key, m.innerM[key] + 1);
        m.sum++;
    }

    function dec_pre(S storage m, uint256 key) internal returns (uint256 RET) {
        return set(m, key, m.innerM[key] - 1);
        m.sum--;
    }

    function dec(S storage m, uint256 key) internal returns (uint256 RET) {
        RET = m.innerM[key];
        set(m, key, m.innerM[key] - 1);
        m.sum--;
    }
}
contract Foo {
    event AssertionFailed(string message);

    uint256_to_uint256.S internal a;

    constructor() {
        uint256_to_uint256.set(a, 0, 10);
    }

    function set(uint k, uint v) public {
        _original_Foo_set(k, v);
        unchecked {
            if (!((a.sum > 10) && (a.sum < 20))) {
                emit AssertionFailed("0: ");
                assert(false);
            }
        }
    }

    function _original_Foo_set(uint k, uint v) private {
        uint256_to_uint256.set(a, k, v);
    }
}
