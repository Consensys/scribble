import { compileSol, compileSourceString, LatestCompilerVersion } from "solc-typed-ast";
import BN from "bn.js";
import crypto from "crypto";
import Account from "ethereumjs-account";
import { Transaction } from "ethereumjs-tx";
import * as util from "ethereumjs-util";
import VM from "ethereumjs-vm";
import { RunTxResult } from "ethereumjs-vm/dist/runTx";
import expect from "expect";

const abi = require("ethereumjs-abi");
const { promisify } = require("util");

export type AliasMap = Map<string, any>;
export type ContractBytecodeMap = Map<string, Buffer>;
export type LogEntry = [Buffer[], any[]];

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
    readonly address: Buffer;

    constructor(privateKey: Buffer) {
        this.privateKey = privateKey;
        this.address = util.privateToAddress(privateKey);
    }

    async register(vm: VM, data?: any) {
        const stateManager = vm.stateManager;
        const put = promisify(stateManager.putAccount.bind(stateManager));

        await put(this.address, new Account(data));
    }

    async getAccount(vm: VM): Promise<Account> {
        const stateManager = vm.stateManager;
        const get = promisify(stateManager.getAccount.bind(stateManager));

        return get(this.address);
    }
}

/**
 * @see https://github.com/b-mueller/sabre/blob/master/lib/compiler.js#L222-L229
 */
function compileSource(
    fileName: string,
    contents?: string,
    version: string = LatestCompilerVersion
): ContractBytecodeMap {
    let data: any;

    if (contents) {
        data = compileSourceString(fileName, contents, version, []).data;
    } else {
        data = compileSol(fileName, "auto", []).data;
    }

    const result = new Map<string, Buffer>();

    const contracts: { [name: string]: any } = data.contracts[fileName];

    for (const [name, meta] of Object.entries(contracts)) {
        const bytecode = meta && meta.evm && meta.evm.bytecode && meta.evm.bytecode.object;

        if (bytecode !== undefined) {
            result.set(name, Buffer.from(bytecode, "hex"));
        }
    }

    return result;
}

function encodeCallArgs(args: CallArgs): Buffer {
    return abi.rawEncode(args.types, args.values);
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

            const topics: Buffer[] = log[1];
            const values: any[] = abi.rawDecode(types, log[2]);

            logs.push([topics, values]);
        }
    }

    return logs;
}

async function deployContract(
    vm: VM,
    sender: User,
    bytecode: Buffer,
    args?: CallArgs,
    logs?: string[][]
): Promise<[Buffer | undefined, LogEntry[]]> {
    const payload = args ? Buffer.concat([bytecode, encodeCallArgs(args)]) : bytecode;

    const tx = new Transaction({
        value: 0,
        gasLimit: 200000000,
        gasPrice: 1,
        data: payload,
        nonce: (await sender.getAccount(vm)).nonce
    });

    tx.sign(sender.privateKey);

    const result = await vm.runTx({ tx });
    const exception = result.execResult.exceptionError;

    if (exception) {
        throw new Error(exception.error);
    }

    const emittedLogs = logs ? extractTxLogs(logs, result) : [];

    return [result.createdAddress, emittedLogs];
}

async function txCall(
    vm: VM,
    sender: User,
    contractAddress: Buffer,
    options: CallOptions
): Promise<[any[], LogEntry[]]> {
    const tx = new Transaction({
        to: contractAddress,
        value: 0,
        gasLimit: 2000000,
        gasPrice: 1,
        data: createCallPayload(options),
        nonce: (await sender.getAccount(vm)).nonce
    });

    tx.sign(sender.privateKey);

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
    contractAddress: Buffer,
    options: CallOptions
): Promise<any[]> {
    const result = await vm.runCall({
        to: contractAddress,
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

function getContractByteCode(contracts: ContractBytecodeMap, name: string): Buffer {
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

function resolveAddressAlias(aliases: AliasMap, key: string): Buffer {
    const value = resolveAlias(aliases, key);

    if (value instanceof Buffer && value.length === 20) {
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
                resolved = resolved.address;
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

                expect(actual instanceof BN ? actual.toString() : actual).toEqual(expected);
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
                let actual = values[v] instanceof BN ? values[v].toString() : values[v];
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
 * @see https://github.com/ethereumjs/ethereumjs-vm/tree/master/packages/vm/examples/run-solidity-contract
 */
export function executeTestSuite(fileName: string, config: Config): void {
    const sample = config.file;

    describe(`Test suite ${fileName} with sample ${sample}`, () => {
        const env = {} as Environment;

        before(() => {
            env.vm = new VM();
            env.aliases = new Map<string, any>();
            env.contracts = compileSource(sample, config.contents);
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
export function executeTestSuiteInternal(fileName: string, config: Config, version: string): void {
    const sample = config.file;

    const env = {} as Environment;

    env.vm = new VM();
    env.aliases = new Map<string, any>();
    env.contracts = compileSource(sample, config.contents, version);

    for (const step of config.steps) {
        const processor = processors.get(step.act);

        if (processor === undefined) {
            throw new Error(`Unsupported step "${step.act}"`);
        }

        processor(env, step);
    }
}
