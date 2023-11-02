pragma solidity ^0.8.8;

contract Errors {
    error E();
    /// #if_succeeds true;
    function foo() public {}
}

// ---------------------------------------------

contract RevertStmt {
	error E();
	/// #if_succeeds false;
	function foo() public {
		revert E();
	}
}

// ---------------------------------------------

enum A {
    A,
    B,
    C
}

type Price is uint32;

contract UserDefinedValueTypes {
    type Quantity is uint32;

    /// #if_succeeds Price.unwrap(p) * Quantity.unwrap(q) == Price.unwrap($result);
    function orderPrice(Price p, Quantity q) public returns (Price) {
        return Price.wrap(Price.unwrap(p) * Quantity.unwrap(q));
    }
}

// ---------------------------------------------

uint constant SOME = 10;

function addSome(uint v) pure returns (uint) {
    return v + SOME;
}

contract FreeFuncs {
    uint num;

    /// #if_succeeds {:msg "P1"} num == 25;
    function operate() public {
        num = addSome(15);
    }
}

// ---------------------------------------------

contract Foo {
	/// #if_succeeds old(1) > 0;
	function main() public {}
}

// ---------------------------------------------

event X(uint a);

contract Ev {
	/// #if_succeeds true;
	function main() public {
        emit X(1);
    }
}
