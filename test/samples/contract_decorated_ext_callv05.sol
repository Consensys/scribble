pragma solidity 0.5.10;
/// invariant {:msg ""} x>0;
contract Foo {
    int x = 1;
    function inc() public payable {
        x++;
    }

    function fail_int() internal {
        x = 0;
        // Should detect failure here
        this.inc.value(0)();
        x = 0;
        // Should detect failure here
        this.inc.gas(10000)();
        x = 0;
        // Should detect failure here
        this.inc.value(0).gas(10000)();
    }

    function fail() public {
        fail_int();
    }

    function withdraw(uint _amount) public {
        (bool success, bytes memory retval) = msg.sender.call.value(_amount)("");
        require(success);
  }
}
