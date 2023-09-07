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

/// #require x == 5;
contract Example03 {
    uint private immutable x;

    constructor() {
        x = 5;
    }
}

contract Example04 {
    uint private immutable x;

    /// #require x == 5;
    constructor() {
        x = 5;
    }
}


