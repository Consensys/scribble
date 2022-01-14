pragma solidity 0.8.8;

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