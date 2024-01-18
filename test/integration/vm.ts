import { Chain, Common, Hardfork } from "@ethereumjs/common";
import { TransactionFactory } from "@ethereumjs/tx";
import { Account, Address, privateToAddress } from "@ethereumjs/util";
import { RunTxResult, VM } from "@ethereumjs/vm";
import bigInt from "big-integer";
import BN from "bn.js";
import crypto from "crypto";
import expect from "expect";
import { assert, compileSol, compileSourceString, LatestCompilerVersion } from "solc-typed-ast";
import { getCompilerKind } from "./utils";
import { gte } from "semver";

const abi = require("ethereumjs-abi");

export type AliasMap = Map<string, any>;
export type ContractBytecodeMap = Map<string, Uint8Array>;
export type LogEntry = [Uint8Array[], any[]];

export interface Environment {
    vm: VM;
    aliases: AliasMap;
    contracts: ContractBytecodeMap;
}

export interface AliasReference {
    alias: string;
}

export interface CallArgs {
    types: string[];
    values: any[];
}

export interface CallOptions {
    method: string;
    args?: CallArgs;
    returns?: string[];
    logs?: string[][];
}

export interface Step {
    act: string;

    [key: string]: any;
}

export interface Config {
    file: string;
    contents?: string;
    steps: Step[];
}

type StepProcessor = (env: Environment, step: Step) => void;

class User {
    readonly privateKey: Buffer;
    readonly address: Address;

    constructor(privateKey: Buffer) {
        this.privateKey = privateKey;
        this.address = new Address(privateToAddress(privateKey));
    }

    async register(vm: VM, data?: any): Promise<void> {
        if ("balance" in data) {
            /**
             * Workaround for support of scientific notation numbers.
             * Convert them to hexadecimal instead.
             */
            data.balance = "0x" + bigInt(data.balance).toString(16);
        }

        return vm.stateManager.putAccount(this.address, Account.fromAccountData(data));
    }

    async getAccount(vm: VM): Promise<Account> {
        const account = await vm.stateManager.getAccount(this.address);

        assert(account !== undefined, `Unable to get account for address ${this.address}`);

        return account;
    }
}

/**
 * @see https://github.com/b-mueller/sabre/blob/master/lib/compiler.js#L222-L229
 */
async function compileSource(
    fileName: string,
    contents?: string,
    version: string = LatestCompilerVersion
): Promise<{ bytecodes: ContractBytecodeMap; hardfork: Hardfork }> {
    const compilerKind = getCompilerKind();

    const { data, compilerVersion } = await (contents
        ? compileSourceString(
              fileName,
              contents,
              version,
              undefined,
              undefined,
              undefined,
              compilerKind
          )
        : compileSol(fileName, "auto", undefined, undefined, undefined, compilerKind));

    assert(compilerVersion !== undefined, "Expected compiler version to be defined");

    const bytecodes = new Map<string, Uint8Array>();
    const contracts: { [name: string]: any } = data.contracts[fileName];

    for (const [name, meta] of Object.entries(contracts)) {
        const bytecode = meta && meta.evm && meta.evm.bytecode && meta.evm.bytecode.object;

        if (bytecode !== undefined) {
            bytecodes.set(name, Buffer.from(bytecode, "hex"));
        }
    }

    return { bytecodes, hardfork: getHardForkForCompiler(compilerVersion) };
}

function encodeCallArgs(args: CallArgs): Buffer {
    const ts: any[] = [];
    const vs: any[] = [];

    assert(args.types.length === args.values.length, `Length mismatch for types and values`);

    for (let i = 0; i < args.values.length; i++) {
        const t = args.types[i];
        let v = args.values[i];

        if (t === "address" && v instanceof Uint8Array) {
            v = "0x" + [...v].map((b) => b.toString(16).padStart(2, "0")).join("");
        }

        ts.push(t);
        vs.push(v);
    }

    return abi.rawEncode(ts, vs);
}

function createCallPayload(options: CallOptions): Buffer {
    if (options.args === undefined) {
        return abi.methodID(options.method, []);
    }

    const args = encodeCallArgs(options.args);
    const selector: Buffer = abi.methodID(options.method, options.args.types);

    return Buffer.concat([selector, args]);
}

function extractTxLogs(specifications: string[][], result: RunTxResult): LogEntry[] {
    const logs: LogEntry[] = [];

    if (result.execResult.logs) {
        for (let i = 0; i < specifications.length; i++) {
            const types = specifications[i];
            const log = result.execResult.logs[i];

            const topics: Uint8Array[] = log[1];
            const values: any[] = abi.rawDecode(types, log[2]);

            logs.push([topics, values]);
        }
    }

    return logs;
}

async function deployContract(
    vm: VM,
    sender: User,
    bytecode: Uint8Array,
    args?: CallArgs,
    logs?: string[][]
): Promise<[Uint8Array | undefined, LogEntry[]]> {
    let payload: Uint8Array;

    if (args) {
        const encodedArgs = encodeCallArgs(args);

        payload = new Uint8Array(bytecode.length + encodedArgs.length);

        payload.set(bytecode);
        payload.set(encodedArgs, bytecode.length);
    } else {
        payload = bytecode;
    }

    const txData = {
        value: 0,
        gasLimit: 200000000,
        gasPrice: 7,
        data: payload,
        nonce: (await sender.getAccount(vm)).nonce
    };

    const tx = TransactionFactory.fromTxData(txData).sign(sender.privateKey);
    const result = await vm.runTx({ tx });
    const exception = result.execResult.exceptionError;

    if (exception) {
        throw new Error(exception.error);
    }

    const emittedLogs = logs ? extractTxLogs(logs, result) : [];

    return [result.createdAddress ? result.createdAddress.bytes : undefined, emittedLogs];
}

async function txCall(
    vm: VM,
    sender: User,
    contractAddress: Uint8Array,
    options: CallOptions
): Promise<[any[], LogEntry[]]> {
    const txData = {
        to: contractAddress,
        value: 0,
        gasLimit: 2000000,
        gasPrice: 7,
        data: createCallPayload(options),
        nonce: (await sender.getAccount(vm)).nonce
    };

    const tx = TransactionFactory.fromTxData(txData).sign(sender.privateKey);

    const result = await vm.runTx({ tx });
    const exception = result.execResult.exceptionError;

    if (exception) {
        throw new Error(exception.error);
    }

    const values =
        options.returns === undefined
            ? []
            : abi.rawDecode(options.returns, result.execResult.returnValue);

    const logs = options.logs ? extractTxLogs(options.logs, result) : [];

    return [values, logs];
}

async function staticCall(
    vm: VM,
    caller: User,
    contractAddress: Uint8Array,
    options: CallOptions
): Promise<any[]> {
    const result = await vm.evm.runCall({
        to: new Address(contractAddress),
        caller: caller.address,
        origin: caller.address,
        data: createCallPayload(options)
    });

    const exception = result.execResult.exceptionError;

    if (exception) {
        throw new Error(exception.error);
    }

    const values =
        options.returns === undefined
            ? []
            : abi.rawDecode(options.returns, result.execResult.returnValue);

    return values;
}

function getContractByteCode(contracts: ContractBytecodeMap, name: string): Uint8Array {
    const bytecode = contracts.get(name);

    if (bytecode === undefined) {
        throw new Error(`Bytecode for contract "${name}" not found in compiler output`);
    }

    return bytecode;
}

function isAliasReference(value: any): value is AliasReference {
    if (value === undefined || value === null) {
        return false;
    }

    return typeof value.alias === "string";
}

function resolveAlias(aliases: AliasMap, key: string): any {
    const value = aliases.get(key);

    if (value === undefined) {
        throw new Error(`Aliased value for key "${key}" is not defined`);
    }

    return value;
}

function resolveUserAlias(aliases: AliasMap, key: string): User {
    const value = resolveAlias(aliases, key);

    if (value instanceof User) {
        return value;
    }

    throw new Error(`Aliased value for key "${key}" is not a user`);
}

function resolveAddressAlias(aliases: AliasMap, key: string): Uint8Array {
    const value = resolveAlias(aliases, key);

    if (value instanceof Uint8Array && value.length === 20) {
        return value;
    }

    throw new Error(`Aliased value for key "${key}" is not an address`);
}

/**
 * Replaces any alias references, that are supplied in `values`,
 * by extracting corresponding values from `aliases` map.
 *
 * Note that results are required to be compatible with
 * ABI raw encoding requirements:
 * any `Buffer`s should be converted to hex string values.
 *
 * The function is supposed to be applied to a call arguments,
 * prior their use in `txCall()`, `staticCall()` or `deployContract()`.
 */
function patchCallValues(values: any[], aliases: AliasMap): any[] {
    const result: any[] = [];

    for (const value of values) {
        if (isAliasReference(value)) {
            let resolved = resolveAlias(aliases, value.alias);

            if (resolved instanceof User) {
                resolved = resolved.address.bytes;
            }

            if (resolved instanceof Buffer) {
                resolved = "0x" + resolved.toString("hex");
            }

            result.push(resolved);
        } else {
            result.push(value);
        }
    }

    return result;
}

function processReturns(aliases: AliasMap, tasks: any[], values: any[]): void {
    for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];

        if (task === null) {
            continue;
        }

        const actual = values[i];

        if (task.alias) {
            aliases.set(task.alias, actual);
        }

        if (task.expect) {
            if (isAliasReference(task.expect)) {
                const expected = resolveAlias(aliases, task.expect.alias);

                expect(actual).toEqual(expected);
            } else {
                const expected = task.expect;

                expect(BN.isBN(actual) ? actual.toString() : actual).toEqual(expected);
            }
        }
    }
}

function processLogs(aliases: AliasMap, tasks: any[], logs: LogEntry[]): void {
    for (let i = 0; i < tasks.length; i++) {
        const expectations = tasks[i];

        if (expectations === null) {
            continue;
        }

        const [, values] = logs[i];

        for (let v = 0; v < expectations.length; v++) {
            if (isAliasReference(expectations[v])) {
                const expected = resolveAlias(aliases, expectations[v].alias);
                const actual = values[v];

                expect(actual).toEqual(expected);
            } else {
                const expected = expectations[v];

                let actual = BN.isBN(values[v]) ? values[v].toString() : values[v];

                if (actual instanceof Buffer) {
                    actual = actual.toJSON().data;
                }

                expect(actual).toEqual(expected);
            }
        }
    }
}

const processors = new Map<string, StepProcessor>([
    [
        "createUser",
        (env: Environment, step: Step) => {
            it(`User ${step.alias} registers`, async () => {
                const privateKey = crypto.randomBytes(32);
                const user = new User(privateKey);

                await user.register(env.vm, step.options);

                env.aliases.set(step.alias, user);
            });
        }
    ],
    [
        "deployContract",
        (env: Environment, step: Step) => {
            it(`User ${step.user} deploys ${step.contract} as ${step.alias}`, async () => {
                const sender = resolveUserAlias(env.aliases, step.user);
                const bytecode = getContractByteCode(env.contracts, step.contract);

                if (step.args !== undefined) {
                    step.args.values = patchCallValues(step.args.values, env.aliases);
                }

                const call = deployContract(env.vm, sender, bytecode, step.args, step.logs);

                if (step.failure) {
                    await expect(call).rejects.toThrow(
                        step.failure === "*" ? undefined : step.failure
                    );
                } else {
                    const [address, logs] = await call;

                    if (address === undefined) {
                        throw new Error(
                            `Deployment address for contract "${step.name}" is undefined`
                        );
                    }

                    env.aliases.set(step.alias, address);

                    if (step.onLogs) {
                        processLogs(env.aliases, step.onLogs, logs);
                    }
                }
            });
        }
    ],
    [
        "staticCall",
        (env: Environment, step: Step) => {
            it(`User ${step.user} calls ${step.contract}.${step.method}() statically`, async () => {
                const caller = resolveUserAlias(env.aliases, step.user);
                const address = resolveAddressAlias(env.aliases, step.contract);

                const options: CallOptions = {
                    method: step.method,
                    args: step.args,
                    returns: step.returns
                };

                if (options.args !== undefined) {
                    options.args.values = patchCallValues(options.args.values, env.aliases);
                }

                const call = staticCall(env.vm, caller, address, options);

                if (step.failure) {
                    await expect(call).rejects.toThrow(
                        step.failure === "*" ? undefined : step.failure
                    );
                } else {
                    const values = await call;

                    if (step.onReturns) {
                        processReturns(env.aliases, step.onReturns, values);
                    }
                }
            });
        }
    ],
    [
        "txCall",
        (env: Environment, step: Step) => {
            it(`User ${step.user} calls ${step.contract}.${step.method}()`, async () => {
                const sender = resolveUserAlias(env.aliases, step.user);
                const address = resolveAddressAlias(env.aliases, step.contract);

                const options: CallOptions = {
                    method: step.method,
                    args: step.args,
                    returns: step.returns,
                    logs: step.logs
                };

                if (options.args !== undefined) {
                    options.args.values = patchCallValues(options.args.values, env.aliases);
                }

                const call = txCall(env.vm, sender, address, options);

                if (step.failure) {
                    await expect(call).rejects.toThrow(
                        step.failure === "*" ? undefined : step.failure
                    );
                } else {
                    const [values, logs] = await call;

                    if (step.onReturns) {
                        processReturns(env.aliases, step.onReturns, values);
                    }

                    if (step.onLogs) {
                        processLogs(env.aliases, step.onLogs, logs);
                    }
                }
            });
        }
    ]
]);

/**
 * @see https://docs.soliditylang.org/en/latest/using-the-compiler.html#target-options
 */
export function getHardForkForCompiler(compilerVersion: string): Hardfork {
    if (gte(compilerVersion, "0.8.20")) {
        return Hardfork.Shanghai;
    }

    if (
        gte(compilerVersion, "0.8.0") ||
        gte(compilerVersion, "0.7.0") ||
        gte(compilerVersion, "0.6.0")
    ) {
        return Hardfork.Berlin;
    }

    return Hardfork.Constantinople;
}

/**
 * @see https://github.com/ethereumjs/ethereumjs-vm/tree/master/packages/vm/examples/run-solidity-contract
 */
export async function executeTestSuite(fileName: string, config: Config): Promise<void> {
    const sample = config.file;

    describe(`Test suite ${fileName} with sample ${sample}`, () => {
        const env = {} as Environment;

        before(async () => {
            const { bytecodes, hardfork } = await compileSource(sample, config.contents);
            const common = new Common({ chain: Chain.Mainnet, hardfork });

            env.vm = await VM.create({ common });
            env.aliases = new Map<string, any>();
            env.contracts = bytecodes;
        });

        for (const step of config.steps) {
            const processor = processors.get(step.act);

            if (processor === undefined) {
                throw new Error(`Unsupported step "${step.act}"`);
            }

            processor(env, step);
        }
    });
}

/**
 * Internal version of executeTestSuite that may be called from another mocha test.
 * @todo remove code duplication with executeTestSuite
 */
export async function executeTestSuiteInternal(config: Config, version: string): Promise<void> {
    const sample = config.file;

    const env = {} as Environment;

    const { bytecodes, hardfork } = await compileSource(sample, config.contents, version);

    const common = new Common({ chain: Chain.Mainnet, hardfork });

    env.vm = await VM.create({ common });
    env.aliases = new Map<string, any>();
    env.contracts = bytecodes;

    for (const step of config.steps) {
        const processor = processors.get(step.act);

        if (processor === undefined) {
            throw new Error(`Unsupported step "${step.act}"`);
        }

        processor(env, step);
    }
}
