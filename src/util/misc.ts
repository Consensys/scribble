import {
    ASTNode,
    ASTWriter,
    DefaultASTWriterMapping,
    FunctionDefinition,
    FunctionStateMutability,
    PrettyFormatter,
    FunctionVisibility,
    VariableDeclaration,
    SourceUnit,
    ContractDefinition,
    LatestCompilerVersion
} from "solc-typed-ast";
import { pp } from ".";

export function nodeToSource(main: ASTNode, targetCompilerVersion = "0.6.0"): string {
    const formatter = new PrettyFormatter(4);
    const writer = new ASTWriter(DefaultASTWriterMapping, formatter, targetCompilerVersion);

    return writer.write(main);
}

export function assert(condition: boolean, message: string): asserts condition {
    if (condition) {
        return;
    }

    throw new Error(message);
}

export function isChangingState(fn: FunctionDefinition): boolean {
    return ![
        FunctionStateMutability.Constant,
        FunctionStateMutability.Pure,
        FunctionStateMutability.View
    ].includes(fn.stateMutability);
}

export function isExternallyVisible(fn: FunctionDefinition): boolean {
    return [
        FunctionVisibility.External,
        FunctionVisibility.Public,
        FunctionVisibility.Default
    ].includes(fn.visibility);
}

/**
 * Given a collection of `T`'s `args`,
 * assert that there is exactly 1 `T` in `args` and return it.
 *
 * @param args  collection that should contain a single `T`
 * @param msg   optional error message
 */
export function single<T>(args: T[] | readonly T[], msg?: string): T {
    if (args.length === 1) {
        return args[0];
    }

    if (msg === undefined) {
        msg = `Expected a single entry, not ${args.length}: ${args}`;
    }

    throw new Error(msg);
}

function stringify(o: any): string {
    try {
        return JSON.stringify(o);
    } catch {
        return `${o}`;
    }
}

export function getOr<K, V>(m: Map<K, V>, key: K, defaultV?: V): V {
    const res = m.get(key);

    if (res !== undefined) {
        return res;
    }

    if (defaultV === undefined) {
        throw new Error(`Expected a value for ${stringify(key)} in ${stringify(m)}`);
    }

    return defaultV;
}

export function getScopeFun(n: ASTNode | undefined): FunctionDefinition | undefined {
    while (n !== undefined && !(n instanceof FunctionDefinition)) {
        n = n.parent;
    }

    return n;
}

export function forAll<T>(arr: T[] | Set<T>, cb: (arg0: T) => boolean): boolean {
    for (const el of arr) {
        if (!cb(el)) {
            return false;
        }
    }

    return true;
}

export function forAny<T>(arr: T[] | Set<T>, cb: (arg0: T) => boolean): boolean {
    for (const el of arr) {
        if (cb(el)) {
            return true;
        }
    }

    return false;
}

export function getOrInit<K, V>(key: K, m: Map<K, V>, def?: V): V {
    if (m.has(key)) {
        return m.get(key) as V;
    }

    assert(def !== undefined, ``);

    m.set(key, def);

    return def;
}

export function getScopeUnit(
    node: ContractDefinition | FunctionDefinition | VariableDeclaration
): SourceUnit {
    if (node instanceof ContractDefinition) {
        return node.vScope;
    }

    if (node instanceof FunctionDefinition) {
        return node.vScope instanceof ContractDefinition ? node.vScope.vScope : node.vScope;
    }

    assert(
        node.vScope instanceof ContractDefinition,
        "Instrumenting is supported for state variables only"
    );

    return node.vScope.vScope;
}

/**
 * Given an array `arr` return a new array with all the elements of
 * `arr` but without duplicates. Elements are compared with the `===`.
 */
export function dedup<T>(arr: T[]): T[] {
    const res: T[] = [];
    const seen = new Set<T>();

    for (const el of arr) {
        if (seen.has(el)) {
            continue;
        }

        seen.add(el);
        res.push(el);
    }

    return res;
}

/**
 * Build a flattened version of the array of arrays `arr` and return it.
 */
export function flatten<T>(arr: Iterable<T[]>): T[] {
    const res: T[] = [];
    for (const el of arr) {
        res.push(...el);
    }

    return res;
}

/**
 * Given a list of T's `things` and a partial ordering between them `order` return
 * a topologically sorted version of `things`. For any pair `[a,b]` in `order` we assume
 * that `a` has to come before `b`.
 */
export function topoSort<T>(things: T[], order: Array<[T, T]>): T[] {
    const successors = new Map<T, Set<T>>();
    const nPreds = new Map<T, number>();

    // Initialize datastructures
    for (const thing of things) {
        nPreds.set(thing, 0);
        successors.set(thing, new Set());
    }

    // Populate nPreds and successors according to the partial order `order`
    for (const [a, b] of order) {
        nPreds.set(b, (nPreds.get(b) as number) + 1);
        (successors.get(a) as Set<T>).add(b);
    }

    // Compute the initial roots and add them to res
    const res: T[] = [];
    for (const thing of things) {
        if ((nPreds.get(thing) as number) === 0) {
            res.push(thing);
        }
    }

    assert(res.length > 0, `Order ${pp(order)} is not a proper partial order`);
    let i = 0;

    // Add nodes to the order until all are added
    while (res.length < things.length) {
        const curLength = res.length;

        // For every newly added node N from last iteration ([i...curLength-1]),
        // and for all successors S of N, reduce nPreds[S]. If nPreds[S] == 0 add to res.
        for (; i < curLength; i++) {
            for (const successor of successors.get(res[i]) as Set<T>) {
                const newCount = (nPreds.get(successor) as number) - 1;
                nPreds.set(successor, newCount);

                if (newCount === 0) {
                    res.push(successor);
                }
            }
        }

        assert(
            res.length > curLength,
            `Order ${pp(order)} is not a valid proper order. Topo sort stalled at ${
                res.length
            } out of ${things.length}`
        );
    }

    return res;
}

/**
 * Zips the two arrays `a1` and `a2` and return the result.
 */
export function zip<T1, T2>(a1: readonly T1[], a2: readonly T2[]): Array<[T1, T2]> {
    assert(
        a1.length === a2.length,
        `Mismatch in length between ${pp(a1)} of len ${a1.length} and ${pp(a2)} of len ${a2.length}`
    );

    const res: Array<[T1, T2]> = [];
    for (let i = 0; i < a1.length; i++) {
        res.push([a1[i], a2[i]]);
    }

    return res;
}

const writersCache = new Map<string, ASTWriter>();

/**
 * Print the ASTNode `n` as Solidity code. Optionally accepts a version string (otherwise assumes 0.8.0)
 */
export function print(n: ASTNode, version = LatestCompilerVersion): string {
    let writer = writersCache.get(version);
    if (writer === undefined) {
        writer = new ASTWriter(DefaultASTWriterMapping, new PrettyFormatter(4), "0.8.0");
        writersCache.set(version, writer);
    }

    return writer.write(n);
}

/**
 * Destructively updates the `updatee` map by adding any mappings found in the `newVals` map.
 * If `disjoint` is specified asserts that the maps are disjoint.
 */
export function updateMap<T1, T2>(
    updatee: Map<T1, T2>,
    newVals: Map<T1, T2>,
    disjoint = false
): void {
    for (const [key, val] of newVals.entries()) {
        if (disjoint) {
            assert(!updatee.has(key), `Expected maps to be disjoint. Instead both have ${key}`);
        }

        updatee.set(key, val);
    }
}
