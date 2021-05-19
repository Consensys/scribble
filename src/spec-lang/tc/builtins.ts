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
    TypeNode
} from "solc-typed-ast";
import { BuiltinStructType } from "./internal_types";

export const BuiltinSymbols = new Map<string, TypeNode | [TypeNode, string]>([
    ["abi", new BuiltinStructType("abi", new Map())],
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

export const BuiltinAddressMembers = new Map<string, TypeNode | [TypeNode, string]>([
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
