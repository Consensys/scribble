import "./A.sol";

/// #invariant true;
contract B {
  function a(A a) external returns (A) { return a; }
}
