type Custom is uint256;

function plus(Custom a, Custom b) pure returns (Custom) {
    return Custom.wrap(Custom.unwrap(a) + Custom.unwrap(b));
}

function diff(Custom a, Custom b) pure returns (Custom) {
    return Custom.wrap(Custom.unwrap(a) - Custom.unwrap(b));
}

using { plus as +, diff as - } for Custom global;

function ops(Custom a, Custom b) pure returns (Custom, Custom) {
    return (a + b, a - b);
}

contract A {
    function a() virtual public {
        b();
    }

    function b() internal {}
}

contract B is A {
    function a() virtual override public {
        b();
        c();
    }

    function c() internal {}
}

contract C {
    function d() internal {}
    function e() internal {
        Custom x = Custom.wrap(1);
        Custom y = Custom.wrap(2);

        x + y;
        x - y;

        ops(x, y);
    }
}

contract D is B, C {
    function a() virtual override public {
        b();
        c();
        d();
    }
}

contract E is B {}
