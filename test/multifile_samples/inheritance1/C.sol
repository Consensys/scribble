import "./A.sol";
import "./B.sol";
/// invariant {:msg "P1"} true;
contract C is B, A { 
    /// if_succeeds $result >= x+2;
    function foo(uint x) public virtual override returns (uint) {
        return x+2;
    }
}
