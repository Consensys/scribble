import "./B.sol";

/// #invariant true;
contract A {
  function a(B b) external returns (B) { return b; }
}
