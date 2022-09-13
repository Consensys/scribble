pragma solidity 0.8.10;

contract Foo {
    type CustomValueType is uint32;

    /// #if_updated forall(uint k in m) m[k][0] > 1;
        mapping(uint=>mapping(uint => uint)) m;

    /// #if_updated forall(CustomValueType t in _map) true;
    mapping(CustomValueType => uint) _map;

    function main() public {
        m[0][1] = 1;
    }

    function some(CustomValueType t, uint v) external {
        _map[t] = v;
    }
}
