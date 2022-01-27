import "./erc20_base.sol";
/**
 * #macro erc20(balances, allowances, _totalSupply);
 */
 contract Token is ERC20 {
     constructor() public ERC20(100000) {
     }

    function allowance(address owner, address delegate) public override view returns (uint) {
        return ERC20.allowance(owner, delegate);
    }
 }