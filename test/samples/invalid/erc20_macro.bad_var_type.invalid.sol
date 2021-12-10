// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.6.0;

interface IERC20 {
    event Transfer(address indexed from, address indexed to, int256 value);
    event Approval(address indexed owner, address indexed spender, int256 value);

    function totalSupply() external view returns (int256);
    function balanceOf(address account) external view returns (int256);
    function allowance(address owner, address spender) external view returns (int256);

    function transfer(address recipient, int256 amount) external returns (bool);
    function approve(address spender, int256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, int256 amount) external returns (bool);
}

/**
 * #macro erc20(balances, allowances);
 */
contract ERC20Example is IERC20 {
    using SafeMath for int256;

    string public constant name = "ERC20Example";
    string public constant symbol = "XMPL";
    int8 public constant decimals = 18;

    event Approval(address indexed tokenOwner, address indexed spender, int tokens);
    event Transfer(address indexed from, address indexed to, int tokens);

    mapping(address => int256) balances;
    mapping(address => mapping (address => int256)) allowances;

    int256 _totalSupply;

    constructor(int256 total) public {
        _totalSupply = total;

        balances[msg.sender] = _totalSupply;
    }

    function totalSupply() public override view returns (int256) {
        return _totalSupply;
    }

    function balanceOf(address account) public override view returns (int256) {
        return balances[account];
    }

    function transfer(address receiver, int256 amount) public override returns (bool) {
        require(amount <= balances[msg.sender]);

        balances[msg.sender] = balances[msg.sender].sub(amount);
        balances[receiver] = balances[receiver].add(amount);

        emit Transfer(msg.sender, receiver, amount);

        return true;
    }

    function approve(address delegate, int256 amount) public override returns (bool) {
        allowances[msg.sender][delegate] = amount;

        emit Approval(msg.sender, delegate, amount);

        return true;
    }

    function allowance(address owner, address delegate) public override view returns (int) {
        return allowances[owner][delegate];
    }

    function transferFrom(address owner, address buyer, int256 amount) public override returns (bool) {
        require(amount <= balances[owner]);
        require(amount <= allowances[owner][msg.sender]);

        balances[owner] = balances[owner].sub(amount);
        allowances[owner][msg.sender] = allowances[owner][msg.sender].sub(amount);
        balances[buyer] = balances[buyer].add(amount);

        emit Transfer(owner, buyer, amount);

        return true;
    }
}

library SafeMath {
    function sub(int256 a, int256 b) internal pure returns (int256) {
        require(b <= a, "Underflow");

        return a - b;
    }

    function add(int256 a, int256 b) internal pure returns (int256) {
        int256 c = a + b;

        require(c >= a, "Overflow");

        return c;
    }
}
