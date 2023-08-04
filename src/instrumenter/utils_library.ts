import {
    Block,
    ContractDefinition,
    ContractKind,
    DataLocation,
    EventDefinition,
    FunctionCallKind,
    FunctionDefinition,
    FunctionKind,
    FunctionStateMutability,
    FunctionVisibility,
    LiteralKind,
    Mutability,
    SourceUnit,
    StateVariableVisibility,
    TypeName,
    VariableDeclaration
} from "solc-typed-ast";
import { ScribbleBuiltinFunctions } from "../spec-lang/ast";
import { InstrumentationContext } from "./instrumentation_context";

// keccak256("__Scribble.isInContract__")
const SCRIBBLE_IS_IN_CONTRACT_HASH =
    "0x5f0b92cf9616afdee4f4136f66393f1343b027f01be893fa569eb2e2b667a40c";

function makeIsInContractFun(
    lib: ContractDefinition,
    ctx: InstrumentationContext
): FunctionDefinition {
    const factory = ctx.factory;

    const fun = factory.makeFunctionDefinition(
        lib.id,
        FunctionKind.Function,
        "isInContract",
        false,
        FunctionVisibility.Internal,
        /**
         * @todo State mutability should be "view" instead,
         * but this would require an update of test artifacts.
         */
        FunctionStateMutability.NonPayable,
        false,
        factory.makeParameterList([]),
        factory.makeParameterList([]),
        [],
        undefined,
        factory.makeBlock([])
    );

    const retDecl = factory.makeVariableDeclaration(
        false,
        false,
        "res",
        fun.vReturnParameters.id,
        false,
        DataLocation.Default,
        StateVariableVisibility.Default,
        Mutability.Mutable,
        "<missing>",
        undefined,
        factory.makeElementaryTypeName("<missing>", "bool")
    );

    fun.vReturnParameters.appendChild(retDecl);

    ctx.addGeneralInstrumentation(retDecl);

    const asm = factory.makeInlineAssembly([], undefined, {
        nodeType: "YulBlock",
        src: "<missing>",
        statements: [
            {
                nodeType: "YulAssignment",
                value: {
                    nodeType: "YulFunctionCall",
                    functionName: {
                        nodeType: "YulIdentifier",
                        name: "sload",
                        src: "<missing>"
                    },
                    src: "<missing>",
                    arguments: [
                        {
                            nodeType: "YulLiteral",
                            kind: "number",
                            src: "<missing>",
                            type: "",
                            value: SCRIBBLE_IS_IN_CONTRACT_HASH
                        }
                    ]
                },
                variableNames: [
                    {
                        nodeType: "YulIdentifier",
                        name: "res",
                        src: "<missing>"
                    }
                ]
            }
        ]
    });

    (fun.vBody as Block).appendChild(asm);

    ctx.addGeneralInstrumentation(asm);

    return fun;
}

function makeSetInContractFun(
    lib: ContractDefinition,
    ctx: InstrumentationContext
): FunctionDefinition {
    const factory = ctx.factory;

    const fun = factory.makeFunctionDefinition(
        lib.id,
        FunctionKind.Function,
        "setInContract",
        false,
        FunctionVisibility.Internal,
        FunctionStateMutability.NonPayable,
        false,
        factory.makeParameterList([]),
        factory.makeParameterList([]),
        [],
        undefined,
        factory.makeBlock([])
    );

    fun.vParameters.appendChild(
        factory.makeVariableDeclaration(
            false,
            false,
            "v",
            fun.vParameters.id,
            false,
            DataLocation.Default,
            StateVariableVisibility.Default,
            Mutability.Mutable,
            "<missing>",
            undefined,
            factory.makeElementaryTypeName("<missing>", "bool")
        )
    );

    const asm = factory.makeInlineAssembly([], undefined, {
        nodeType: "YulBlock",
        src: "<missing>",
        statements: [
            {
                nodeType: "YulFunctionCall",
                functionName: {
                    nodeType: "YulIdentifier",
                    name: "sstore",
                    src: "<missing>"
                },
                src: "<missing>",
                arguments: [
                    {
                        nodeType: "YulLiteral",
                        kind: "number",
                        src: "<missing>",
                        type: "",
                        value: SCRIBBLE_IS_IN_CONTRACT_HASH
                    },
                    {
                        nodeType: "YulIdentifier",
                        src: "<missing>",
                        name: "v"
                    }
                ]
            }
        ]
    });

    (fun.vBody as Block).appendChild(asm);

    ctx.addGeneralInstrumentation(asm);

    return fun;
}

function makeEventEmitFun(
    lib: ContractDefinition,
    name: string,
    eventDef: EventDefinition,
    argTs: Array<[TypeName, DataLocation]>,
    ctx: InstrumentationContext
): FunctionDefinition {
    const factory = ctx.factory;

    const fun = factory.makeFunctionDefinition(
        lib.id,
        FunctionKind.Function,
        name,
        false,
        FunctionVisibility.Internal,
        FunctionStateMutability.NonPayable,
        false,
        factory.makeParameterList([]),
        factory.makeParameterList([]),
        [],
        undefined,
        factory.makeBlock([])
    );

    const args: VariableDeclaration[] = argTs.map(([typ, loc], idx) =>
        factory.makeVariableDeclaration(
            false,
            false,
            `arg_${idx}`,
            fun.id,
            false,
            loc,
            StateVariableVisibility.Default,
            Mutability.Mutable,
            "<missing>",
            undefined,
            typ
        )
    );

    for (const arg of args) {
        fun.vParameters.appendChild(arg);
    }

    const callStmt = factory.makeFunctionCall(
        "<missing>",
        FunctionCallKind.FunctionCall,
        factory.makeIdentifierFor(eventDef),
        args.map((arg) => factory.makeIdentifierFor(arg))
    );

    (fun.vBody as Block).appendChild(factory.makeEmitStatement(callStmt));

    ctx.addGeneralInstrumentation(callStmt);

    return fun;
}

function makeAssertionFailedEventDef(ctx: InstrumentationContext): EventDefinition {
    const factory = ctx.factory;

    const def = factory.makeEventDefinition(
        false,
        "AssertionFailed",
        factory.makeParameterList([])
    );

    const message = factory.makeVariableDeclaration(
        false,
        false,
        "message",
        def.id,
        false,
        DataLocation.Default,
        StateVariableVisibility.Default,
        Mutability.Mutable,
        "<missing>",
        undefined,
        factory.makeElementaryTypeName("<missing>", "string")
    );

    def.vParameters.vParameters.push(message);

    return def;
}

function makeAssertionFailedDataEventDef(ctx: InstrumentationContext): EventDefinition {
    const factory = ctx.factory;

    const def = factory.makeEventDefinition(
        false,
        `AssertionFailedData`,
        factory.makeParameterList([])
    );

    const eventId = factory.makeVariableDeclaration(
        false,
        false,
        "eventId",
        def.id,
        false,
        DataLocation.Default,
        StateVariableVisibility.Default,
        Mutability.Mutable,
        "int",
        undefined,
        factory.makeElementaryTypeName("<missing>", "int")
    );

    const encodingData = factory.makeVariableDeclaration(
        false,
        false,
        "encodingData",
        def.id,
        false,
        DataLocation.Default,
        StateVariableVisibility.Default,
        Mutability.Mutable,
        "bytes",
        undefined,
        factory.makeElementaryTypeName("<missing>", "bytes")
    );

    def.vParameters.appendChild(eventId);
    def.vParameters.appendChild(encodingData);

    return def;
}

export function makeEqBytesFun(
    lib: ContractDefinition,
    ctx: InstrumentationContext
): FunctionDefinition {
    const factory = ctx.factory;

    const body = factory.makeBlock([]);
    const fun = factory.makeFunctionDefinition(
        lib.id,
        FunctionKind.Function,
        ScribbleBuiltinFunctions.eq_encoded,
        false,
        FunctionVisibility.Internal,
        FunctionStateMutability.Pure,
        false,
        factory.makeParameterList([]),
        factory.makeParameterList([]),
        [],
        undefined,
        body
    );

    const a = factory.makeVariableDeclaration(
        false,
        false,
        "a",
        fun.id,
        false,
        DataLocation.Memory,
        StateVariableVisibility.Default,
        Mutability.Mutable,
        "bytes",
        undefined,
        factory.makeElementaryTypeName("<missing>", "bytes")
    );

    const b = factory.makeVariableDeclaration(
        false,
        false,
        "b",
        fun.id,
        false,
        DataLocation.Memory,
        StateVariableVisibility.Default,
        Mutability.Mutable,
        "bytes",
        undefined,
        factory.makeElementaryTypeName("<missing>", "bytes")
    );

    const ret = factory.makeVariableDeclaration(
        false,
        false,
        "",
        fun.id,
        false,
        DataLocation.Default,
        StateVariableVisibility.Default,
        Mutability.Mutable,
        "<missing>",
        undefined,
        factory.makeElementaryTypeName("<missing>", "bool")
    );

    fun.vParameters.appendChild(a);
    fun.vParameters.appendChild(b);

    fun.vReturnParameters.appendChild(ret);

    ctx.addGeneralInstrumentation(ret);

    const lenEqCheck = factory.makeIfStatement(
        factory.makeBinaryOperation(
            "bool",
            "!=",
            factory.makeMemberAccess("uint256", factory.makeIdentifierFor(a), "length", -1),
            factory.makeMemberAccess("uint256", factory.makeIdentifierFor(b), "length", -1)
        ),
        factory.makeReturn(
            fun.vReturnParameters.id,
            factory.makeLiteral("bool", LiteralKind.Bool, "", "false")
        )
    );

    const retStmt = factory.makeReturn(
        fun.vReturnParameters.id,
        factory.makeBinaryOperation(
            "bool",
            "==",
            factory.makeFunctionCall(
                "bytes32",
                FunctionCallKind.FunctionCall,
                factory.makeIdentifier("<missing>", "keccak256", -1),
                [factory.makeIdentifierFor(a)]
            ),
            factory.makeFunctionCall(
                "bytes32",
                FunctionCallKind.FunctionCall,
                factory.makeIdentifier("<missing>", "keccak256", -1),
                [factory.makeIdentifierFor(b)]
            )
        )
    );

    body.appendChild(lenEqCheck);
    body.appendChild(retStmt);

    ctx.addGeneralInstrumentation(lenEqCheck);
    ctx.addGeneralInstrumentation(retStmt);

    return fun;
}

/**
 * Generate the `__ScribbleUtilsLib__XX` library for a specific file `file`.
 * This library contains:
 *
 * 1. The AssertionFailed and AssertionFailedData events
 * 2. Helper functions `getOutOfContract` and `setOutOfContract` that check whether we were out of the contract just prior to this call. Note that those contain assembly.
 *
 * Note: We duplicate this library for each file that is instrumented to avoid messing around with adding imports. Import paths can get compilcated
 * when:
 *
 * a) instrumenting both files in the main repo and under node_modules,
 * b) when you have to account for various path options to the compiler (path remapping, --base-path, --include-path, --allow-paths, etc)
 * c) when having to deal with different OSs (looking at you Windows).
 *
 * So its easiest just not to change the imports at all.
 */
export function generateUtilsLibrary(
    file: SourceUnit,
    ctx: InstrumentationContext
): ContractDefinition {
    const factory = ctx.factory;

    const lib = factory.makeContractDefinition(
        `__ScribbleUtilsLib__${file.id}`,
        file.id,
        ContractKind.Library,
        false,
        true,
        [],
        [],
        [],
        undefined
    );

    lib.linearizedBaseContracts.push(lib.id);

    if (ctx.assertionMode !== "hardhat") {
        const assertionFailedDef = makeAssertionFailedEventDef(ctx);

        lib.appendChild(assertionFailedDef);

        const assertionFailedDataDef = makeAssertionFailedDataEventDef(ctx);

        lib.appendChild(assertionFailedDataDef);

        lib.appendChild(
            makeEventEmitFun(
                lib,
                "assertionFailed",
                assertionFailedDef,
                [[factory.makeElementaryTypeName("<missing>", "string"), DataLocation.Memory]],
                ctx
            )
        );

        lib.appendChild(
            makeEventEmitFun(
                lib,
                "assertionFailedData",
                assertionFailedDataDef,
                [
                    [factory.makeElementaryTypeName("<missing>", "int"), DataLocation.Default],
                    [factory.makeElementaryTypeName("<missing>", "bytes"), DataLocation.Memory]
                ],
                ctx
            )
        );
    }

    lib.appendChild(makeIsInContractFun(lib, ctx));
    lib.appendChild(makeSetInContractFun(lib, ctx));

    file.appendChild(lib);

    return lib;
}
