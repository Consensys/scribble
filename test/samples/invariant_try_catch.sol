pragma solidity 0.8.15;

interface Bar {
	function bar() external;
}

/// #invariant true;
contract Foo {
	function main(bool flag, Bar b) internal {
		if (flag)
			try b.bar() {
			} catch Error(string memory reason) {
				revert(reason);
			} catch Panic(uint code) {
				revert("panic");
			} catch {
				revert("foo");
			}
	}
}
