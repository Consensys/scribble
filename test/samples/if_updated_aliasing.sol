contract IfUpdatedAliasing {
        //// if_updated true;
        uint[] a1;
        uint[] a2;

		//// if_updated true;
        uint[][] aa1;
        uint[][] aa2;

        function main() public {
                a1.push(1);
                // Aliasing is ok, as long as the aliased variable doesn't have annotations
                uint[] storage p = a2;
                p.push(2);

                (a1[0], p[0]) = (p[0], a1[0]);
                assert(a1[0] == 2 && a2[0] == 1);

                aa1.push(a1);
                uint[][] storage pp = aa2;
                pp.push(a2);

                assert(aa1[0][0] == 2 && aa2[0][0] == 1);
                (aa1[0], pp[0]) = (pp[0], aa1[0]);

                assert(aa1[0][0] == 2 && aa2[0][0] == 2);

        }
}