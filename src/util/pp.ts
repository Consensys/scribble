import { ASTNode, ContractDefinition } from "solc-typed-ast";

export interface PPAble {
    pp(): string;
}

export function isPPAble(a: any): a is PPAble {
    return typeof a.pp === "function";
}

export function pp(x: any): string {
    if (x === undefined) {
        return "<undefined>";
    }

    if (
        x === null ||
        typeof x === "string" ||
        typeof x === "number" ||
        typeof x === "boolean" ||
        typeof x === "bigint"
    ) {
        return String(x);
    }

    if (x instanceof Array) {
        return ppArr(x);
    }

    if (x instanceof Set) {
        return ppSet(x);
    }

    if (x instanceof Map) {
        return ppMap(x);
    }

    if (isPPAble(x)) {
        return x.pp();
    }

    if (x instanceof ContractDefinition) {
        return `contract ${x.name}`;
    }

    if (x instanceof ASTNode) {
        return ppASTNode(x);
    }

    return String(x);
}

export function ppArr(arr: any[], sep = ",", start = "[", end = "]"): string {
    return start + arr.map(pp).join(sep) + end;
}

export function ppIter(iter: Iterable<any>, sep = ",", start = "[", end = "]"): string {
    const parts: string[] = [];

    for (const part of iter) {
        parts.push(pp(part));
    }

    return start + parts.join(sep) + end;
}

export function ppSet(set: Set<any>, sep = ",", start = "{", end = "}"): string {
    return ppIter(set, sep, start, end);
}

export function ppMap(map: Map<any, any>, sep = ",", kvSep = ":", start = "{", end = "}"): string {
    const parts: string[] = [];

    for (const [name, val] of map.entries()) {
        parts.push(pp(name) + kvSep + pp(val));
    }

    return start + parts.join(sep) + end;
}

export function ppASTNode(node: ASTNode): string {
    return `${node.constructor.name}#${node.id}`;
}
