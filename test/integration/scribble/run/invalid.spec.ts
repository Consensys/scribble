import expect from "expect";
import { scribble } from "../../utils";

describe(`Command "scribble <filename>" is failing as expected`, () => {
    const cases: Array<[string[], RegExp | string]> = [
        [[""], /^Path is empty/g],
        [["missing.sol"], /^Path not found: missing\.sol/g],
        [["test/"], /^Target is not a file: test\//g],
        [
            ["test/samples/invalid/missing_terminator_semicolon.invalid.sol"],
            /^test\/samples\/invalid\/missing_terminator_semicolon.invalid.sol:12:8 SyntaxError: Expected .* but .* found/m
        ],
        [
            ["test/samples/invalid/invalid_annotation.invalid.sol"],
            /^test\/samples\/invalid\/invalid_annotation.invalid.sol:9:8 SyntaxError: Expected "!=", "%", "&", "&&", "\*", "\*\*", "\+", "-", "\.", "\/", ";", "<<", "==", "==>", ">>", "\?", "\[", "\^", "days", "ether", "gwei", "hours", "minutes", "seconds", "weeks", "wei", "\|", "\|\|", or whitespace but "d" found/m
        ],
        [
            ["test/samples/invalid/annotation_syntax_error.invalid.sol"],
            /^test\/samples\/invalid\/annotation_syntax_error.invalid.sol:5:35 SyntaxError: Expected .* but .* found/m
        ],
        [
            ["test/samples/invalid/annotation_sem_error.invalid.sol"],
            /^test\/samples\/invalid\/annotation_sem_error.invalid.sol:5:33 TypeError: if_succeeds expects an expression of type bool not uint256/m
        ],
        [
            ["test/samples/invalid/annotation_type_error.invalid.sol"],
            /^test\/samples\/invalid\/annotation_type_error.invalid.sol:5:34 TypeError: Operation '!' expectes bool not uint256 in \(!x\)/m
        ],
        [
            ["test/samples/invalid/type_error.invalid.sol"],
            /^test\/samples\/invalid\/type_error.invalid.sol:2:38 TypeError: Types of x \(uint256\) and y \(int256\) are incompatible/m
        ],
        [
            ["test/samples/invalid/invariant_on_function.invalid.sol"],
            /^test\/samples\/invalid\/invariant_on_function.invalid.sol:2:9 UnsupportedByTargetError: The "invariant" annotation is not applicable to functions/m
        ],
        [
            ["test/samples/invalid/if_succeeds_on_free_function.invalid.sol"],
            /^test\/samples\/invalid\/if_succeeds_on_free_function.invalid.sol:3:5 UnsupportedByTargetError: Instrumenting free functions is not supported/m
        ],
        [
            ["test/samples/invalid/if_updated_length.invalid.sol"],
            /^test\/samples\/invalid\/if_updated_length.invalid.sol:7:2 Error: Cannot instrument state var LengthAssigned.a due to unsupported assignments to .length/m
        ],
        [
            ["test/samples/invalid/if_updated_push_ref.invalid.sol"],
            /.*Error: Scribble doesn't support instrumenting assignments where the LHS is a push\(\). Problematic LHS: a.push\(\)/m
        ],
        [
            ["test/samples/invalid/if_updated_aliasing1.invalid.sol"],
            /^test\/samples\/invalid\/if_updated_aliasing1.invalid.sol:7:2 Error: Cannot instrument state var BadAliasing.a as it may be aliased by a storage pointer/m
        ],
        [
            ["test/samples/invalid/if_updated_aliasing2.invalid.sol"],
            /^test\/samples\/invalid\/if_updated_aliasing2.invalid.sol:7:2 Error: Cannot instrument state var BadAliasing.a as it may be aliased by a storage pointer/m
        ],
        [
            ["test/samples/invalid/if_updated_aliasing3.invalid.sol"],
            /^test\/samples\/invalid\/if_updated_aliasing3.invalid.sol:9:3 Error: Cannot instrument state var BadAliasing.a1 as it may be aliased by a storage pointer/m
        ],
        [
            ["test/samples/invalid/if_updated_aliasing4.invalid.sol"],
            /^test\/samples\/invalid\/if_updated_aliasing4.invalid.sol:4:13 Error: Cannot instrument state var BadAliasing.a as it may be aliased by a storage pointer/m
        ],
        [
            ["test/samples/invalid/if_updated_aliasing5.invalid.sol"],
            /^test\/samples\/invalid\/if_updated_aliasing5.invalid.sol:4:13 Error: Cannot instrument state var BadAliasing.a as it may be aliased by a storage pointer/m
        ],
        [
            ["test/samples/invalid/forall_maps_aliasing1.invalid.sol"],
            /^test\/samples\/invalid\/forall_maps_aliasing1.invalid.sol:7:2 Error: Cannot instrument state var BadAliasing.a as it may be aliased by a storage pointer/m
        ],
        [
            ["test/samples/invalid/forall_maps_aliasing2.invalid.sol"],
            /^test\/samples\/invalid\/forall_maps_aliasing2.invalid.sol:12:2 Error: Cannot instrument state var BadAliasing.s as it may be aliased by a storage pointer/m
        ],
        [
            ["test/samples/invalid/assert_try_catch.invalid.sol"],
            /^test\/samples\/invalid\/assert_try_catch.invalid.sol:7:9 UnsupportedByTargetError: The "assert" annotation is not applicable to try-catch clauses/m
        ],
        [
            ["test/samples/invalid/if_updated_old_inline_initializer.invalid.sol"],
            /^test\/samples\/invalid\/if_updated_old_inline_initializer.invalid.sol:2:26 TypeError: old\(\) expressions not yet supported for state variable x with an ininine-initializer/m
        ],
        [
            ["test/samples/invalid/ambiguous_binding1.invalid.sol"],
            /^test\/samples\/invalid\/ambiguous_binding1.invalid.sol:1:19 TypeError: Type of let-var a is not uniquely defined from the right hand side. Please add a type cast on the right-hand side to set it \(e.g. uint\(1\)\)/m
        ],
        [
            ["test/samples/invalid/ambiguous_binding2.invalid.sol"],
            /^test\/samples\/invalid\/ambiguous_binding2.invalid.sol:1:16 TypeError: Type of let expression is not uniquely defined from its body. Please add a type cast around the body to define it. \(e.g. uint\(0\)\)/m
        ],
        [
            ["test/samples/invalid/try.old.invalid.sol"],
            /^test\/samples\/invalid\/try.old.invalid.sol:5:13 TypeError: old\(\) expressions not allowed in 'try' annotations. try always executes before the function call./m
        ],
        [
            ["test/samples/invalid/require.old.invalid.sol"],
            /^test\/samples\/invalid\/require.old.invalid.sol:4:17 TypeError: old\(\) expressions not allowed in 'require' annotations. require always executes before the function call./m
        ],
        [
            ["test/samples/invalid/require.svar.invalid.sol"],
            /^test\/samples\/invalid\/require.svar.invalid.sol:2:9 UnsupportedByTargetError: The "require" annotation is not applicable to state variables/m
        ],
        [
            ["test/samples/invalid/try.svar.invalid.sol"],
            /^test\/samples\/invalid\/try.svar.invalid.sol:2:9 UnsupportedByTargetError: The "try" annotation is not applicable to state variables/m
        ],
        [
            [
                "test/samples/hints.sol",
                "--macro-path",
                "test/samples/invalid/macro.syntax_error.invalid.yaml"
            ],
            /^.*\/macro.syntax_error.invalid.yaml:1:0 YamlSchemaError: Expected map not !@#dqwlkm ""/
        ],
        [
            [
                "test/samples/invalid/macro.good_fun_arg_type.sol",
                "--macro-path",
                "test/samples/invalid/macro.syntax_error1.invalid.yaml"
            ],
            /^.*\/macro.syntax_error1.invalid.yaml:6:36 SyntaxError: Expected .* but .* found.*/
        ],
        [
            [
                "test/samples/hints.sol",
                "--macro-path",
                "test/samples/invalid/macro.bad_schema1.invalid.yaml"
            ],
            /^.*\/macro.bad_schema1.invalid.yaml:3:16 YamlSchemaError: Expected a scalar string value, not 1/
        ],
        [
            [
                "test/samples/hints.sol",
                "--macro-path",
                "test/samples/invalid/macro.empty.invalid.yaml"
            ],
            /^.*\/macro.empty.invalid.yaml:1:0 YamlSchemaError: Unexpected empty yaml file in .*macro.empty.invalid.yaml.*/
        ],
        [
            ["test/samples/invalid/ownable_macro.no_var.invalid.sol"],
            /^.*\/ownable_macro.no_var.invalid.sol:5:4 MacroError: No target owner1 found in contract Ownable for macro ownable\(owner1\).*/
        ],
        [
            ["test/samples/invalid/ownable_macro.bad_var_type.invalid.sol"],
            /^.*\/ownable.scribble.yaml:7:32 TypeError: Types of old\(owner\) \(uint256\) and msg.sender \(address\) are incompatible.*/
        ],
        [
            [
                "test/samples/invalid/macro.bad_fun_arg_type.invalid.sol",
                "--macro-path",
                "test/samples/macros/foo.scribble.yaml"
            ],
            /^.*\/foo.scribble.yaml:6:33 TypeError: Types of x \(uint256\) and y \(int8\) are incompatible.*/
        ],
        [
            [
                "test/samples/invalid/macro.good_fun_arg_type.sol",
                "--macro-path",
                "test/samples/invalid/macro.sem_error.invalid.yaml"
            ],
            /^.*\/macro.sem_error.invalid.yaml:6:37 TypeError: Nested old\(\) expressions not allowed: old\(x\) is already inside an old\(\).*/
        ],
        [
            ["test/samples/invalid/deprecated_no_hash.warning.sol", "-o", "tmp.sol"],
            /.*test\/samples\/invalid\/deprecated_no_hash.warning.sol:2:4 Warning: The following looks like an annotation but was ignored due to # missing before first keyword. If it is an annotation please add '#' before first keyword.*/g
        ],
        [
            ["test/samples/invalid/deprecated_whitespace_natspec.warning.sol", "-o", "tmp.sol"],
            /.*test\/samples\/invalid\/deprecated_whitespace_natspec.warning.sol:2:4 Warning: The following looks like an annotation but was ignored due to garbage before '@custom:scribble' \(see https:\/\/github.com\/ethereum\/solidity\/issues\/12245\).*/g
        ],
        [
            ["test/samples/invalid/garbage_at_start.warning.sol", "-o", "tmp.sol"],
            /.*test\/samples\/invalid\/garbage_at_start.warning.sol:2:4 Warning: The following looks like an annotation but was ignored due to garbage before first keyword.*/g
        ],
        [
            ["test/samples/hints.sol", "--compiler-kind", "unknown"],
            /.*Unsupported compiler kind "unknown". Possible values: wasm, native.*/g
        ],
        [
            ["test/samples/invalid/forall_iterator_type_incompatible.invalid.sol"],
            /.*TypeError: The type bytes32 of the iterator variable x is not castable to the array index type uint of hashes.*/g
        ],
        [
            ["test/samples/invalid/consts_unordered.invalid.sol"],
            /.*TypeError: Unknown identifier Y*/g
        ],
        [
            ["test/samples/invalid/consts_diff_contracts.invalid.sol"],
            /.*TypeError: Unknown identifier D*/g
        ],
        [
            ["test/samples/invalid/consts_non_const.invalid.sol"],
            /.*TypeError: Cannot use non-constant expression msg.value in constant definition.*/g
        ],
        [
            ["test/samples/invalid/userDefinedTypesInFunction.invalid.sol"],
            /.*TypeError: Missing data location for argument policy of function isPolicyValid.*/g
        ],
        [
            ["test/samples/invalid/if_updated_fun_return_ptr_bad.sol"],
            /.*Error: Cannot instrument state var Foo.arr as it may be aliased by a storage pointer.*/g
        ],
        [
            ["test/samples/invalid/immutables.sol"],
            /.*TypeError: require annotation on constructor cannot use immutable state variable x*/g
        ]
    ];

    for (const [args, message] of cases) {
        describe(`scribble ${args.join(" ")}`, () => {
            it("STDERR is correct", () => {
                expect(() => scribble(args)).toThrow(message);
            });
        });
    }
});
