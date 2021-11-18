pragma solidity 0.8.7;

/// #require z > 1;
///  #try msg.sender == address(0x0); 
contract Foo {
    struct vars0 {
        uint256 __mstore_scratch__;
    }

    struct vars1 {
        uint256 __mstore_scratch__;
    }

    struct vars2 {
        uint256 __mstore_scratch__;
    }

    uint internal z;

    function bar(uint x) public {
        vars0 memory _v;
        unchecked {
            require(x > 2);
            if (x < 10) _v.__mstore_scratch__ = 42;
            require(z > 1);
            if (msg.sender == address(0x0)) _v.__mstore_scratch__ = 42;
        }
        _original_Foo_bar(x);
    }

    function _original_Foo_bar(uint x) private {
        vars2 memory _v;
        unchecked {
            require(x > 10);
            if (x == 9) _v.__mstore_scratch__ = 42;
        }
        uint z = x + 1;
    }

    function boo() public {
        vars1 memory _v;
        unchecked {
            require(z > 1);
            if (msg.sender == address(0x0)) _v.__mstore_scratch__ = 42;
        }
        _original_Foo_boo();
    }

    function _original_Foo_boo() private {}

    function baz() internal {}
}

/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}
