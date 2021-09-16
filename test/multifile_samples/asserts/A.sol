uint constant X = 2;

struct Point {
    uint x;
    uint y;
}

function foo(Point memory p) pure returns (uint) {
    return p.x + p.y;
}