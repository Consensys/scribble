pragma solidity 0.8.10;

contract AssertFor1 {
	function main(uint n) public {
		uint sum = 0;
		for (/** #assert true; */ uint i = 0; i < n; i++) {
			sum += i;
		}
	}
}

contract AssertFor2 {
	function main(uint n) public {
		uint sum = 0;
		for (uint i = 0; i < n; /** #assert true; */ i++) {
			sum += i;
		}
	}
}

contract AssertForAll {
	function main(uint[] memory n) public {
		uint sum = 0;
		/// #assert forall (uint i in n) n[i] < 100; 
		for (uint i = 0; i < n.length; i++) {
			sum += n[i];
		}
	}
}

contract AssertFunCall {
    uint t;
    
    function foo(uint x, uint y) public view returns (uint, uint) {
        return (x+t, y+t);    
    }
    
    function boo(uint a, uint b) public pure returns (uint) {
        return a + b;
    }

    function main(uint a, uint b, uint newT) public returns (uint) {
        t = newT;
        /// #assert let oldSum := a + b in let a, b := foo(a,b) in oldSum + 2*1 == a + b;
        boo(a,b);
    }
}

/// #invariant sum < 200;
contract AssertMixed {
	/// #if_updated sum - old(sum) > 3;
	uint sum;

	/// #if_succeeds n.length < 10;
	function main(uint[] memory n) public {
		/// #assert forall (uint i in n) n[i] <= 50; 
		for (uint i = 0; i < n.length; i++) {
			/// #assert n[i] > 2;
			sum += n[i];
		}
	}
}

contract SimpleAsserts {
    // Call me with 1,2,3,4
    function main(uint a1, uint a2, uint a3, bool b1, uint a4, uint a5, uint a6, uint a7, uint a8) public {
        /// #assert a1 == 1;
        uint x = 2;
        
        /// #assert a2 == x;
	x++;
        
        /// #assert a3 == x;
        if(b1)
        /** #assert a4 == x + 1; */
        {
            /// #assert a5 == x + 2;
            x++;
        } else {
            x++;
            /// #assert a6 == x + 2;
            int t;
        }
        
        
        while (a6 > 0) {
            /** #assert a7 >= a6+1; */
            a6 --;
        }

	/** #assert a8 == x + 4; */
	{
		x++;
	}
    }
}
