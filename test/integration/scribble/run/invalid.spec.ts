import expect from "expect";
import { scribble } from "../../utils";

describe(`Command "scribble <filename>" is failing as expected`, () => {
    const cases: Array<[string[], RegExp]> = [
        [
            ["test/samples/missing_terminator_semicolon.invalid.sol"],
            /^test\/samples\/missing_terminator_semicolon.invalid.sol:12:8 SyntaxError: Expected (.|\s)+ but (.|\s)+ found/m
        ],
        [
            ["test/samples/annotation_syntax_error.invalid.sol"],
            /^test\/samples\/annotation_syntax_error.invalid.sol:5:34 SyntaxError: Expected (.|\s)+ but (.|\s)+ found/m
        ],
        [
            ["test/samples/invariant_on_function.invalid.sol"],
            /^test\/samples\/invariant_on_function.invalid.sol:2:8 UnsupportedByTargetError: The "invariant" annotation is not applicable to functions/m
        ],
        [
            ["test/samples/if_succeeds_on_free_function.invalid.sol"],
            /^test\/samples\/if_succeeds_on_free_function.invalid.sol:3:4 UnsupportedByTargetError: Instrumenting free functions is not supported/m
        ],
        [
            ["test/samples/if_updated_length.invalid.sol"],
            /^test\/samples\/if_updated_length.invalid.sol:7:2 Error: Cannot instrument state var LengthAssigned.a due to unsupported assignments to .length./m
        ],
        [
            ["test/samples/if_updated_tuple_pointer_05.invalid.sol"],
            /^test\/samples\/if_updated_tuple_pointer_05.invalid.sol:9:2 Error: Scribble cannot instrument certain tuple assignments with storage pointers on compilers older than 0.6.0./m
        ],
        [
            ["test/samples/if_updated_push_ref.invalid.sol"],
            /.*Error: Scribble doesn't support instrument assignments where the LHS is a push\(\). Problematic LHS: a.push\(\)/m
        ],
        [
            ["test/samples/if_assigned_complex.sol", "--debug-events"],
            /.*Error: Scribble doesn't yet support --debug-events in the presence of instrumented state vars: .*/m
        ],
        [
            ["test/samples/if_updated_aliasing1.invalid.sol"],
            /^test\/samples\/if_updated_aliasing1.invalid.sol:7:2 Error: Cannot instrument state var BadAliasing.a as it may be aliased by a storage pointer/m
        ],
        [
            ["test/samples/if_updated_aliasing2.invalid.sol"],
            /^test\/samples\/if_updated_aliasing2.invalid.sol:7:2 Error: Cannot instrument state var BadAliasing.a as it may be aliased by a storage pointer/m
        ]
    ];

    for (const [args, message] of cases) {
        const fileName = args[0];
        describe(`scribble ${fileName}`, () => {
            it("STDERR is correct", () => {
                expect(() => scribble(args)).toThrow(message);
            });
        });
    }
});
