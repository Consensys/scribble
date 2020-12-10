import expect from "expect";
import { scribble } from "../../utils";

describe(`Command "scribble <filename>" is failing as expected`, () => {
    const cases: Array<[string, RegExp]> = [
        [
            "test/samples/missing_terminator_semicolon.invalid.sol",
            /^test\/samples\/missing_terminator_semicolon.invalid.sol:10:8 SyntaxError: Line 10 of .+ documentation string looks like an annotation but is not terminated by a semicolon ";" and is ignored:.+/m
        ],
        [
            "test/samples/annotation_syntax_error.invalid.sol",
            /^test\/samples\/annotation_syntax_error.invalid.sol:5:34 SyntaxError: Expected (.|\s)+ but (.|\s)+ found/m
        ],
        [
            "test/samples/if_succeeds_on_contract.invalid.sol",
            /^Annotation type "if_succeeds" is not applicable to contracts \(specified for .+\)/m
        ]
    ];

    for (const [fileName, message] of cases) {
        describe(`scribble ${fileName}`, () => {
            it("STDERR is correct", () => {
                expect(() => scribble(fileName)).toThrow(message);
            });
        });
    }
});
