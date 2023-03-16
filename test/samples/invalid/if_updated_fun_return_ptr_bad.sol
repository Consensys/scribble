contract Foo {
    /// #if_updated arr.length > 0;
    uint[] arr;

    int8[] arr1;
    function getPtr() internal returns (int8[] storage) {
        return arr1;
    }

    function getPtr1() internal returns (uint[] storage) {
        return arr;
    }

    function main() {
        getPtr().push(0);
    }
}
