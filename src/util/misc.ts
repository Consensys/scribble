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
    ContractDefinition
} from "solc-typed-ast";

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
