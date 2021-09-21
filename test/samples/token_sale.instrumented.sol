pragma solidity 0.5.17;

contract TokenSale {
    event AssertionFailed(string message);

    mapping(address => uint256) public balanceOf;
    uint256 internal constant PRICE_PER_TOKEN = 1 ether;

    constructor() public payable {
        require(msg.value == 1 ether);
    }

    function isComplete() public view returns (bool) {
        return address(this).balance < 1 ether;
    }

    function buy(uint256 numTokens) public payable {
        _original_TokenSale_buy(numTokens);
        if (!(address(this).balance >= 1)) {
            emit AssertionFailed("0: P0");
            assert(false);
        }
    }

    function _original_TokenSale_buy(uint256 numTokens) private {
        require(msg.value == (numTokens * PRICE_PER_TOKEN));
        balanceOf[msg.sender] += numTokens;
    }

    function sell(uint256 numTokens) public {
        _original_TokenSale_sell(numTokens);
        if (!(address(this).balance >= 1)) {
            emit AssertionFailed("1: P1");
            assert(false);
        }
    }

    function _original_TokenSale_sell(uint256 numTokens) private {
        require(balanceOf[msg.sender] >= numTokens);
        balanceOf[msg.sender] -= numTokens;
        msg.sender.transfer(numTokens * PRICE_PER_TOKEN);
    }
}

/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}
