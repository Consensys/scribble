contract Foo {
    /// #if_updated forall(uint i in m) m[i] > 0;
    mapping(uint=>uint) m;

    /// #if_updated m1[address(0x0)]["abcd"] < 5;
    /// #if_assigned false;
    /// #if_assigned[addr] false;
    /// #if_assigned[addr][str] addr == address(0x0); 
    mapping(address => mapping(string => uint)) m1;

    function assign_m(uint pos, uint v) public returns (uint) {
        m[pos] = v;
        return m[pos];
    }

    /// #if_succeeds forall (address a in m1) forall (string memory s in m1[a]) m1[a][s] > 1;
    function assign_m1(address a, string memory s, uint v) public returns (uint) {
        m1[a][s] = v;
        return m1[a][s];
    }

}
