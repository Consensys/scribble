pragma solidity 0.8.7;

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
