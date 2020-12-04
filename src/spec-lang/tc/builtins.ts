import { DataLocation, FunctionStateMutability, FunctionVisibility } from "solc-typed-ast";
import {
    SAddressType,
    SBoolType,
    SBuiltinStructType,
    SBytes,
    SFixedBytes,
    SFunctionType,
    SIntType,
    SPointer,
    SType
} from "../ast";

export const BuiltinSymbols = new Map<string, SType>([
    ["abi", new SBuiltinStructType("abi", new Map())],
    [
        "block",
        new SBuiltinStructType(
            "block",
            new Map<string, SType>([
                ["coinbase", new SAddressType(true)],
                ["difficulty", new SIntType(256, false)],
                ["gaslimit", new SIntType(256, false)],
                ["number", new SIntType(256, false)],
                ["timestamp", new SIntType(256, false)]
            ])
        )
    ],
    [
        "msg",
        new SBuiltinStructType(
            "msg",
            new Map<string, SType>([
                ["data", new SPointer(new SBytes(), DataLocation.CallData)],
                ["sender", new SAddressType(true)],
                ["sig", new SFixedBytes(4)],
                ["value", new SIntType(256, false)]
            ])
        )
    ],
    [
        "tx",
        new SBuiltinStructType(
            "tx",
            new Map<string, SType>([
                ["gasprice", new SIntType(256, false)],
                ["origin", new SAddressType(true)]
            ])
        )
    ],
    [
        "blockhash",
        new SFunctionType(
            [new SIntType(256, false)],
            [new SFixedBytes(32)],
            FunctionVisibility.Default,
            FunctionStateMutability.View
        )
    ],
    [
        "gasleft",
        new SFunctionType(
            [],
            [new SIntType(256, false)],
            FunctionVisibility.Default,
            FunctionStateMutability.View
        )
    ],
    [
        "now",
        new SFunctionType(
            [],
            [new SIntType(256, false)],
            FunctionVisibility.Default,
            FunctionStateMutability.View
        )
    ],
    [
        "addmod",
        new SFunctionType(
            [new SIntType(256, false), new SIntType(256, false), new SIntType(256, false)],
            [new SIntType(256, false)],
            FunctionVisibility.Default,
            FunctionStateMutability.Pure
        )
    ],
    [
        "mulmod",
        new SFunctionType(
            [new SIntType(256, false), new SIntType(256, false), new SIntType(256, false)],
            [new SIntType(256, false)],
            FunctionVisibility.Default,
            FunctionStateMutability.Pure
        )
    ],
    [
        "keccak256",
        new SFunctionType(
            [new SPointer(new SBytes(), DataLocation.Memory)],
            [new SFixedBytes(32)],
            FunctionVisibility.Default,
            FunctionStateMutability.Pure
        )
    ],
    [
        "sha256",
        new SFunctionType(
            [new SPointer(new SBytes(), DataLocation.Memory)],
            [new SFixedBytes(32)],
            FunctionVisibility.Default,
            FunctionStateMutability.Pure
        )
    ],
    [
        "ripemd160",
        new SFunctionType(
            [new SPointer(new SBytes(), DataLocation.Memory)],
            [new SFixedBytes(20)],
            FunctionVisibility.Default,
            FunctionStateMutability.Pure
        )
    ],
    [
        "ecrecover",
        new SFunctionType(
            [new SFixedBytes(32), new SIntType(8, false), new SFixedBytes(32), new SFixedBytes(32)],
            [new SAddressType(false)],
            FunctionVisibility.Default,
            FunctionStateMutability.Pure
        )
    ]
]);

export const BuiltinAddressMembers = new Map<string, SType>([
    ["balance", new SIntType(256, false)],
    [
        "staticcall",
        new SFunctionType(
            [new SPointer(new SBytes(), DataLocation.Memory)],
            [new SBoolType(), new SPointer(new SBytes(), DataLocation.Memory)],
            FunctionVisibility.Default,
            FunctionStateMutability.View
        )
    ]
]);
