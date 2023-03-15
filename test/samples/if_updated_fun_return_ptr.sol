contract Foo {
    /// #if_updated arr.length > 0;
    uint[] arr;

    int8[] arr1;
    function getPtr() internal returns (int8[] storage) {
        return arr1;
    }

    function main() {
        getPtr().push(0);

        arr.push(1);
    }
}
