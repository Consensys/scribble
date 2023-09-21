pragma solidity 0.8.20;
/// #if_succeeds x == 5;
contract Example01 {
    uint private immutable x;

    constructor() {
        x = 5;
    }
}

contract Example02 {
    uint private immutable x;

    /// #if_succeeds x == 5;
    constructor() {
        x = 5;
    }
}

/// #require y == 1;
contract Example03 {
    uint private immutable x;
    uint y = 1;

    constructor() {
        x = 5;
    }
}

contract Example04 {
    uint private immutable x;
    uint y = 1;

    /// #require y == 1;
    constructor() {
        x = 5;
    }
}


