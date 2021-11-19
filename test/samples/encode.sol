contract Foo {
 /// #if_succeeds abi.encode(v).length > 0;
 function foo(uint v) public {
 }

 /// #if_succeeds abi.encodePacked(v).length > 0;
 function foo1(uint v) public {
 }

 /// #if_succeeds abi.encodeWithSelector(bytes4(hex"01020304"), v).length > 0;
 function foo2(uint v) public {
 }

 /// #if_succeeds abi.encodeWithSignature("dummy", v).length > 0;
 function foo3(uint v) public {
 }
}
