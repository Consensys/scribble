// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.6.0;

interface IERC20 {
    event Transfer(address indexed from, address indexed to, uint value);
    event Approval(address indexed owner, address indexed spender, uint value);

    function totalSupply() external view returns (uint);
    function balanceOf(address account) external view returns (uint);
    function allowance(address owner, address spender) external view returns (uint);

    function transfer(address recipient, uint amount) external returns (bool);
    function approve(address spender, uint amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint amount) external returns (bool);
}

contract ERC20 is IERC20 {
    using SafeMath for uint;

    string public constant name = "ERC20Example";
    string public constant symbol = "XMPL";
    uint8 public constant decimals = 18;

    event Approval(address indexed tokenOwner, address indexed spender, uint tokens);
    event Transfer(address indexed from, address indexed to, uint tokens);

    mapping(address => uint) balances;
    mapping(address => mapping (address => uint)) allowances;

    uint _totalSupply;

    constructor(uint total) public {
        _totalSupply = total;

        balances[msg.sender] = _totalSupply;
    }

    function totalSupply() public override view returns (uint) {
        return _totalSupply;
    }

    function balanceOf(address account) public override view returns (uint) {
        return balances[account];
    }

    function transfer(address receiver, uint amount) public override returns (bool) {
        require(amount <= balances[msg.sender]);

        balances[msg.sender] = balances[msg.sender].sub(amount);
        balances[receiver] = balances[receiver].add(amount);

        emit Transfer(msg.sender, receiver, amount);

        return true;
    }

    function approve(address delegate, uint amount) public override returns (bool) {
        allowances[msg.sender][delegate] = amount;

        emit Approval(msg.sender, delegate, amount);

        return true;
    }

    function allowance(address owner, address delegate) public virtual override view returns (uint) {
        return allowances[owner][delegate];
    }

    function transferFrom(address owner, address buyer, uint amount) public override returns (bool) {
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
    function sub(uint a, uint b) internal pure returns (uint) {
        require(b <= a, "Underflow");

        return a - b;
    }

    function add(uint a, uint b) internal pure returns (uint) {
        uint c = a + b;

        require(c >= a, "Overflow");

        return c;
    }
}
