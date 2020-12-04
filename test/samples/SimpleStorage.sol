pragma solidity ^0.5.2;

contract SimpleStorage {
    uint storedData;

    event Notification(uint val, string message);

    constructor(uint data) public {
        storedData = data;
    }

    function set(uint x) public returns (uint) {
        storedData = x;

        emit Notification(x, "set");

        return storedData;
    }

    function get() public view returns (uint) {
        return storedData;
    }

    function fail() public pure {
        assert(false);
    }
}
