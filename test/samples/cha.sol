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
}

contract D is B, C {
    function a() virtual override public {
        b();
        c();
        d();
    }
}

contract E is B {}
