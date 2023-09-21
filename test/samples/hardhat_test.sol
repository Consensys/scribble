pragma solidity 0.8.21;
contract HardHatTest {
    uint8[] b = [1, 2, 3];

    /**
     * #if_succeeds 1 > 2;
     * #if_succeeds let a := uint8(1) in a < 2;
     * #if_succeeds let flag := false in !flag;
     * #if_succeeds let addr := address(0x0) in addr == 0x0000000000000000000000000000000000000000;
     * #if_succeeds let x := int128(-1) in x < 0;
     * #if_succeeds let i := uint256(1) in b[0] == 1 && b[i] == 2 && b[2] == 3;
     *
     * #if_succeeds eq_encoded(str, "abc");
     * #if_succeeds eq_encoded(bts, hex"010203");
     *
     * #if_succeeds let b1 := bytes1(0xff) in b1 > 0x00;
     * #if_succeeds let b2 := bytes2(0xffff) in b2 > 0x00;
     * #if_succeeds let b3 := bytes3(0xffffff) in b3 > 0x00;
     * #if_succeeds let b4 := bytes4(0xffffffff) in b4 > 0x00;
     * #if_succeeds let b5 := bytes5(0xffffffffff) in b5 > 0x00;
     * #if_succeeds let b6 := bytes6(0xffffffffffff) in b6 > 0x00;
     * #if_succeeds let b7 := bytes7(0xffffffffffffff) in b7 > 0x00;
     * #if_succeeds let b8 := bytes8(0xffffffffffffffff) in b8 > 0x00;
     * #if_succeeds let b9 := bytes9(0xffffffffffffffffff) in b9 > 0x00;
     * #if_succeeds let b10 := bytes10(0xffffffffffffffffffff) in b10 > 0x00;
     * #if_succeeds let b11 := bytes11(0xffffffffffffffffffffff) in b11 > 0x00;
     * #if_succeeds let b12 := bytes12(0xffffffffffffffffffffffff) in b12 > 0x00;
     * #if_succeeds let b13 := bytes13(0xffffffffffffffffffffffffff) in b13 > 0x00;
     * #if_succeeds let b14 := bytes14(0xffffffffffffffffffffffffffff) in b14 > 0x00;
     * #if_succeeds let b15 := bytes15(0xffffffffffffffffffffffffffffff) in b15 > 0x00;
     * #if_succeeds let b16 := bytes16(0xffffffffffffffffffffffffffffffff) in b16 > 0x00;
     * #if_succeeds let b17 := bytes17(0xffffffffffffffffffffffffffffffffff) in b17 > 0x00;
     * #if_succeeds let b18 := bytes18(0xffffffffffffffffffffffffffffffffffff) in b18 > 0x00;
     * #if_succeeds let b19 := bytes19(0xffffffffffffffffffffffffffffffffffffff) in b19 > 0x00;
     * #if_succeeds let b20 := bytes20(0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF) in b20 > 0x00;
     * #if_succeeds let b21 := bytes21(0xffffffffffffffffffffffffffffffffffffffffff) in b21 > 0x00;
     * #if_succeeds let b22 := bytes22(0xffffffffffffffffffffffffffffffffffffffffffff) in b22 > 0x00;
     * #if_succeeds let b23 := bytes23(0xffffffffffffffffffffffffffffffffffffffffffffff) in b23 > 0x00;
     * #if_succeeds let b24 := bytes24(0xffffffffffffffffffffffffffffffffffffffffffffffff) in b24 > 0x00;
     * #if_succeeds let b25 := bytes25(0xffffffffffffffffffffffffffffffffffffffffffffffffff) in b25 > 0x00;
     * #if_succeeds let b26 := bytes26(0xffffffffffffffffffffffffffffffffffffffffffffffffffff) in b26 > 0x00;
     * #if_succeeds let b27 := bytes27(0xffffffffffffffffffffffffffffffffffffffffffffffffffffff) in b27 > 0x00;
     * #if_succeeds let b28 := bytes28(0xffffffffffffffffffffffffffffffffffffffffffffffffffffffff) in b28 > 0x00;
     * #if_succeeds let b29 := bytes29(0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffff) in b29 > 0x00;
     * #if_succeeds let b30 := bytes30(0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff) in b30 > 0x00;
     * #if_succeeds let b31 := bytes31(0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff) in b31 > 0x00;
     * #if_succeeds let b32 := bytes32(0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff) in b32 > 0x00;
     *
     * #if_succeeds keccak256(bytes(str)) == keccak256(bts);
     */
    function main(string memory str, bytes memory bts) public {}
}
