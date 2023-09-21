pragma solidity 0.8.20;
/**
 * The original constructor in this sample
 * SHOULD NOT be instrumented.
 *
 * See https://github.com/ConsenSys/scribble/issues/140
 */

/// #invariant true;
contract Foo {

    /// #if_succeeds false;
    constructor(uint x) public {}
}
