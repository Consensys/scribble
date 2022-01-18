import {
    AddressType,
    BoolType,
    BytesType,
    DataLocation,
    FixedBytesType,
    FunctionStateMutability,
    FunctionType,
    FunctionVisibility,
    IntType,
    PointerType,
    StringType,
    TypeNode,
    UserDefinedType
} from "solc-typed-ast";
import { BuiltinStructType, VariableTypes } from "./internal_types";

export const BuiltinSymbols = new Map<string, TypeNode | [TypeNode, string]>([
    [
        "abi",
        new BuiltinStructType(
            "abi",
            new Map<string, TypeNode>([
                [
                    "encode",
                    new FunctionType(
                        "encode",
                        [new VariableTypes()],
                        [new PointerType(new BytesType(), DataLocation.Memory)],
                        FunctionVisibility.Default,
                        FunctionStateMutability.Pure
                    )
                ],
                [
                    "encodePacked",
                    new FunctionType(
                        "encodePacked",
                        [new VariableTypes()],
                        [new PointerType(new BytesType(), DataLocation.Memory)],
                        FunctionVisibility.Default,
                        FunctionStateMutability.Pure
                    )
                ],
                [
                    "encodeWithSelector",
                    new FunctionType(
                        "encodeWithSelector",
                        [new FixedBytesType(4), new VariableTypes()],
                        [new PointerType(new BytesType(), DataLocation.Memory)],
                        FunctionVisibility.Default,
                        FunctionStateMutability.Pure
                    )
                ],
                [
                    "encodeWithSignature",
                    new FunctionType(
                        "encodeWithSignature",
                        [
                            new PointerType(new StringType(), DataLocation.Memory),
                            new VariableTypes()
                        ],
                        [new PointerType(new BytesType(), DataLocation.Memory)],
                        FunctionVisibility.Default,
                        FunctionStateMutability.Pure
                    )
                ]
            ])
        )
    ],
    [
        "block",
        new BuiltinStructType(
            "block",
            new Map<string, TypeNode>([
                ["coinbase", new AddressType(true)],
                ["difficulty", new IntType(256, false)],
                ["gaslimit", new IntType(256, false)],
                ["number", new IntType(256, false)],
                ["timestamp", new IntType(256, false)]
            ])
        )
    ],
    [
        "msg",
        new BuiltinStructType(
            "msg",
            new Map<string, TypeNode>([
                ["data", new PointerType(new BytesType(), DataLocation.CallData)],
                ["sender", new AddressType(true)],
                ["sig", new FixedBytesType(4)],
                ["value", new IntType(256, false)]
            ])
        )
    ],
    [
        "tx",
        new BuiltinStructType(
            "tx",
            new Map<string, TypeNode>([
                ["gasprice", new IntType(256, false)],
                ["origin", new AddressType(true)]
            ])
        )
    ],
    [
        "blockhash",
        new FunctionType(
            undefined,
            [new IntType(256, false)],
            [new FixedBytesType(32)],
            FunctionVisibility.Default,
            FunctionStateMutability.View
        )
    ],
    [
        "gasleft",
        new FunctionType(
            undefined,
            [],
            [new IntType(256, false)],
            FunctionVisibility.Default,
            FunctionStateMutability.View
        )
    ],
    [
        "now",
        new FunctionType(
            undefined,
            [],
            [new IntType(256, false)],
            FunctionVisibility.Default,
            FunctionStateMutability.View
        )
    ],
    [
        "addmod",
        new FunctionType(
            undefined,
            [new IntType(256, false), new IntType(256, false), new IntType(256, false)],
            [new IntType(256, false)],
            FunctionVisibility.Default,
            FunctionStateMutability.Pure
        )
    ],
    [
        "mulmod",
        new FunctionType(
            undefined,
            [new IntType(256, false), new IntType(256, false), new IntType(256, false)],
            [new IntType(256, false)],
            FunctionVisibility.Default,
            FunctionStateMutability.Pure
        )
    ],
    [
        "keccak256",
        new FunctionType(
            undefined,
            [new PointerType(new BytesType(), DataLocation.Memory)],
            [new FixedBytesType(32)],
            FunctionVisibility.Default,
            FunctionStateMutability.Pure
        )
    ],
    [
        "sha256",
        new FunctionType(
            undefined,
            [new PointerType(new BytesType(), DataLocation.Memory)],
            [new FixedBytesType(32)],
            FunctionVisibility.Default,
            FunctionStateMutability.Pure
        )
    ],
    [
        "ripemd160",
        new FunctionType(
            undefined,
            [new PointerType(new BytesType(), DataLocation.Memory)],
            [new FixedBytesType(20)],
            FunctionVisibility.Default,
            FunctionStateMutability.Pure
        )
    ],
    [
        "ecrecover",
        new FunctionType(
            undefined,
            [
                new FixedBytesType(32),
                new IntType(8, false),
                new FixedBytesType(32),
                new FixedBytesType(32)
            ],
            [new AddressType(false)],
            FunctionVisibility.Default,
            FunctionStateMutability.Pure
        )
    ]
]);

export const AddressMembers = new Map<string, TypeNode | [TypeNode, string]>([
    ["balance", new IntType(256, false)],
    [
        "staticcall",
        new FunctionType(
            undefined,
            [new PointerType(new BytesType(), DataLocation.Memory)],
            [new BoolType(), new PointerType(new BytesType(), DataLocation.Memory)],
            FunctionVisibility.Default,
            FunctionStateMutability.View
        )
    ],
    ["code", [new PointerType(new BytesType(), DataLocation.Memory), ">=0.8.0"]]
]);

export const ContractTypeMembers = new BuiltinStructType(
    "<type(contract)>",
    new Map([
        ["name", new PointerType(new StringType(), DataLocation.Memory)],
        ["creationCode", new PointerType(new BytesType(), DataLocation.Memory)],
        ["runtimeCode", new PointerType(new BytesType(), DataLocation.Memory)]
    ])
);

export const InterfaceTypeMembers = new BuiltinStructType(
    "<type(interface)>",
    new Map<string, TypeNode | [TypeNode, string]>([
        ["name", new PointerType(new StringType(), DataLocation.Memory)],
        ["interfaceId", [new FixedBytesType(4), ">=0.6.7"]]
    ])
);

export const NumberLikeTypeMembers = (type: IntType | UserDefinedType): BuiltinStructType => {
    const minVersion = type instanceof IntType ? ">=0.6.8" : ">=0.8.8";
    return new BuiltinStructType(
        "<type(number-like)>",
        new Map<string, TypeNode | [TypeNode, string]>([
            ["min", [type, minVersion]],
            ["max", [type, minVersion]]
        ])
    );
};
