pragma solidity 0.8.4;
import "./base.sol";

contract Foo is Base {
    /// #if_succeeds forall(uint k in a) a[k] > 1;
    function setA(uint key, uint val) public {
        a[key] = val;
    }

    /// #if_succeeds forall(uint k in a) a[k] > 1;
    function decA(uint key) public {
        a[key]--;
    }

    /// #if_succeeds forall (string memory s in c) c[s] > -1;
    function setC(string memory s, int16 v) public {
        c[s] = v;
    }

    /// #if_succeeds forall (string memory s in d) forall (uint8 k in d[s]) d[s][k] > 0;
    function setD(string memory s, uint8 k, int8 v) public {
        d[s][k] = v;
    }

    /// #if_succeeds forall (uint k in e) e[k].length > 0;
    function setE(uint k, uint[] memory v) public {
        e[k] = v;
    }

    function pushF() public {
        f.push();
    }
    /// #if_succeeds forall (uint i in f) f[i][0] > 0;
    function setF(uint i, uint j, uint v) public {
        f[i][j] = v;
    }

    function pushG() public {
        g.push();
    }

    /// #if_succeeds forall (uint k in g[i]) g[i][k] > 0;
    function setG(uint i, uint j, uint v) public {
        g[i][j] = v;
    }

    /// #if_succeeds forall (string memory s in h) h[s][0] > 0;
    function setH(string memory s, uint8 k, int8 v) public {
        h[s][k] = v;
    }

    /// #if_succeeds forall (uint8 x in i[s]) i[s][x] > 0;
    function setI(string memory s, uint8 k, int8 v) public {
        i[s][k] = v;
    }

    function addSA() public {
        j.sas.push();
    }

    /// #if_succeeds forall (string memory s in j.sas[saI].m) j.sas[saI].m[s] > 0;
    function setJ(uint saI, string memory x, uint v) public {
        j.sas[saI].m[x] = v;
    }

    /// #if_succeeds forall(uint i in j.sas) forall (string memory s in j.sas[i].m) j.sas[i].m[s] > 0;
    function setJ2(uint saI, string memory x, uint v) public {
        j.sas[saI].m[x] = v;
    }
}