pragma solidity 0.8.7;

contract Foo {
    event AssertionFailed(string message);

    struct vars0 {
        uint256 i0;
        uint256 k0;
        bool forall_0;
    }

    uint256_to_mapping_uint256_to_uint256.S internal m;

    function main() public {
        Foo_m_idx_uint256_idx_uint256_uint256_assign(0, 1, 1);
    }

    function Foo_m_idx_uint256_idx_uint256_uint256_assign(uint256 ARG0, uint256 ARG1, uint256 ARG2) internal returns (uint256 RET0) {
        vars0 memory _v;
        uint256_to_mapping_uint256_to_uint256.get_lhs(m, ARG0)[ARG1] = ARG2;
        RET0 = uint256_to_mapping_uint256_to_uint256.get_lhs(m, ARG0)[ARG1];
        unchecked {
            _v.forall_0 = true;
            for (_v.i0 = 1; _v.i0 < m.keys.length; _v.i0++) {
                _v.k0 = m.keys[_v.i0];
                _v.forall_0 = uint256_to_mapping_uint256_to_uint256.get(m, _v.k0)[0] > 1;
                if (!_v.forall_0) break;
            }
            if (!(_v.forall_0)) {
                emit AssertionFailed("0: ");
                assert(false);
            }
        }
    }
}

/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}

library uint256_to_mapping_uint256_to_uint256 {
    struct S {
        mapping(uint256 => mapping(uint256 => uint256)) innerM;
        uint256[] keys;
        mapping(uint256 => uint256) keyIdxM;
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

    function get_lhs(S storage m, uint256 key) internal returns (mapping(uint256 => uint256) storage) {
        addKey(m, key);
        return m.innerM[key];
    }

    function get(S storage m, uint256 key) internal view returns (mapping(uint256 => uint256) storage) {
        return m.innerM[key];
    }
}
