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
    Mutability,
    SourceUnit,
    StateVariableVisibility,
    TypeName,
    VariableDeclaration
} from "solc-typed-ast";
import { InstrumentationContext } from "./instrumentation_context";

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
                            /// keccak256("__Scribble.isInContract__")
                            value: "0x5f0b92cf9616afdee4f4136f66393f1343b027f01be893fa569eb2e2b667a40c"
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
                        /// keccak256("__Scribble.isInContract__")
                        value: "0x5f0b92cf9616afdee4f4136f66393f1343b027f01be893fa569eb2e2b667a40c"
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
        undefined
    );

    lib.linearizedBaseContracts.push(lib.id);

    /// Add 'AssertionFailed' event
    const assertionFailedEvtDef = factory.makeEventDefinition(
        false,
        "AssertionFailed",
        factory.makeParameterList([])
    );

    assertionFailedEvtDef.vParameters.vParameters.push(
        factory.makeVariableDeclaration(
            false,
            false,
            "message",
            assertionFailedEvtDef.id,
            false,
            DataLocation.Default,
            StateVariableVisibility.Default,
            Mutability.Mutable,
            "<missing>",
            undefined,
            factory.makeElementaryTypeName("<missing>", "string")
        )
    );

    lib.appendChild(assertionFailedEvtDef);

    /// Add 'AssertionFailedData' event
    const assertionFailedDataEvtDef = factory.makeEventDefinition(
        false,
        `AssertionFailedData`,
        factory.makeParameterList([])
    );

    const eventId = factory.makeVariableDeclaration(
        false,
        false,
        "eventId",
        assertionFailedDataEvtDef.id,
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
        assertionFailedDataEvtDef.id,
        false,
        DataLocation.Default,
        StateVariableVisibility.Default,
        Mutability.Mutable,
        "bytes",
        undefined,
        factory.makeElementaryTypeName("<missing>", "bytes")
    );

    assertionFailedDataEvtDef.vParameters.appendChild(eventId);
    assertionFailedDataEvtDef.vParameters.appendChild(encodingData);
    lib.appendChild(assertionFailedDataEvtDef);

    lib.appendChild(
        makeEventEmitFun(
            lib,
            "assertionFailed",
            assertionFailedEvtDef,
            [[factory.makeElementaryTypeName("<missing>", "string"), DataLocation.Memory]],
            ctx
        )
    );

    lib.appendChild(
        makeEventEmitFun(
            lib,
            "assertionFailedData",
            assertionFailedDataEvtDef,
            [
                [factory.makeElementaryTypeName("<missing>", "int"), DataLocation.Default],
                [factory.makeElementaryTypeName("<missing>", "bytes"), DataLocation.Memory]
            ],
            ctx
        )
    );

    lib.appendChild(makeIsInContractFun(lib, ctx));
    lib.appendChild(makeSetInContractFun(lib, ctx));

    file.appendChild(lib);

    return lib;
}
