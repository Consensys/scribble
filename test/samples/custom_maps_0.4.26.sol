pragma solidity 0.4.26;

contract Foo {
    mapping(address => uint256) private _valueMap;

    /// #if_succeeds forall(address a in _valueMap) _valueMap[a] > 0;
    function foo() public {
    }
}
