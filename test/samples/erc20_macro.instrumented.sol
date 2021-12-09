pragma solidity 0.6.12;

interface IERC20 {
    event Transfer(address indexed from, address indexed to, uint value);

    event Approval(address indexed owner, address indexed spender, uint value);

    function totalSupply() external returns (uint);

    function balanceOf(address account) external returns (uint);

    function allowance(address owner, address spender) external view returns (uint);

    function transfer(address recipient, uint amount) external returns (bool);

    function approve(address spender, uint amount) external returns (bool);

    function transferFrom(address sender, address recipient, uint amount) external returns (bool);
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

/// Utility contract holding a stack counter
contract __scribble_ReentrancyUtils {
    bool __scribble_out_of_contract = true;
}

library address_to_uint256 {
    struct S {
        mapping(address => uint256) innerM;
        address[] keys;
        mapping(address => uint256) keyIdxM;
        uint256 sum;
    }

    function addKey(S storage m, address key) private {
        uint idx = m.keyIdxM[key];
        if (idx == 0) {
            if (m.keys.length == 0) {
                m.keys.push();
            }
            m.keyIdxM[key] = m.keys.length;
            m.keys.push(key);
        }
    }

    function removeKey(S storage m, address key) private {
        uint256 idx = m.keyIdxM[key];
        if (idx == 0) return;
        if (idx != (m.keys.length - 1)) {
            address lastKey = m.keys[m.keys.length - 1];
            m.keys[idx] = lastKey;
            m.keyIdxM[lastKey] = idx;
        }
        m.keys.pop();
        delete m.keyIdxM[key];
    }

    function set(S storage m, address key, uint256 val) internal returns (uint256) {
        m.sum -= m.innerM[key];
        m.sum += val;
        m.innerM[key] = val;
        addKey(m, key);
        return m.innerM[key];
    }

    function get(S storage m, address key) internal view returns (uint256) {
        return m.innerM[key];
    }
}

///  #macro erc20(balances, allowances);
contract ERC20Example is IERC20 {
    using SafeMath for uint;

    event Approval(address indexed tokenOwner, address indexed spender, uint tokens);

    event Transfer(address indexed from, address indexed to, uint tokens);

    event AssertionFailed(string message);

    string public constant name = "ERC20Example";
    string public constant symbol = "XMPL";
    uint8 public constant decimals = 18;
    address_to_uint256.S internal balances;
    mapping(address => mapping(address => uint)) internal allowances;
    uint internal _totalSupply;

    constructor(uint total) public {
        _totalSupply = total;
        address_to_uint256.set(balances, msg.sender, _totalSupply);
    }

    function totalSupply() override public returns (uint RET_0) {
        RET_0 = _original_ERC20Example_totalSupply();
        if (!(RET_0 == balances.sum)) {
            emit AssertionFailed("1: Result is equal to sum of balances");
            assert(false);
        }
    }

    function _original_ERC20Example_totalSupply() private view returns (uint) {
        return _totalSupply;
    }

    function balanceOf(address account) override public returns (uint RET_0) {
        RET_0 = _original_ERC20Example_balanceOf(account);
        if (!(RET_0 == address_to_uint256.get(balances, account))) {
            emit AssertionFailed("2: Returns the balance of owner in the balances mapping");
            assert(false);
        }
    }

    function _original_ERC20Example_balanceOf(address account) private view returns (uint) {
        return address_to_uint256.get(balances, account);
    }

    function transfer(address receiver, uint amount) override public returns (bool) {
        require(amount <= address_to_uint256.get(balances, msg.sender));
        address_to_uint256.set(balances, msg.sender, address_to_uint256.get(balances, msg.sender).sub(amount));
        address_to_uint256.set(balances, receiver, address_to_uint256.get(balances, receiver).add(amount));
        emit Transfer(msg.sender, receiver, amount);
        return true;
    }

    function approve(address delegate, uint amount) override public returns (bool) {
        allowances[msg.sender][delegate] = amount;
        emit Approval(msg.sender, delegate, amount);
        return true;
    }

    function allowance(address owner, address delegate) override public view returns (uint) {
        return allowances[owner][delegate];
    }

    function transferFrom(address owner, address buyer, uint amount) override public returns (bool) {
        require(amount <= address_to_uint256.get(balances, owner));
        require(amount <= allowances[owner][msg.sender]);
        address_to_uint256.set(balances, owner, address_to_uint256.get(balances, owner).sub(amount));
        allowances[owner][msg.sender] = allowances[owner][msg.sender].sub(amount);
        address_to_uint256.set(balances, buyer, address_to_uint256.get(balances, buyer).add(amount));
        emit Transfer(owner, buyer, amount);
        return true;
    }
}
