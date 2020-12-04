import { ContractDefinition, SourceUnit } from "solc-typed-ast";
import { getOr, intersection, assert, eq, forAll } from "../util";
import { Logger } from "../logger";
import { pp } from "../util/pp";

type ParentMap<T> = Map<T, T[]>;
type ChildrenMap<T> = Map<T, Set<T>>;

// Interface containig information about the class hierarchy (CHA)
export interface CHA<T> {
    parents: ParentMap<T>; // Map from contract to its direct bases
    children: ChildrenMap<T>; // Map from contract to its direct children in the CHA
    roots: Set<T>; // The set of roots (contract with no other base) in the CHA
    leaves: Set<T>; // The set of leaves (contract with no subclass) in the CHA
}

export function ppCHA<T>(c: CHA<T>): string {
    return `{parents: ${pp(c.parents)}, children: ${pp(c.children)}, roots: ${pp(
        c.roots
    )}, leaves: ${pp(c.leaves)} }`;
}

/**
 * Check that a CHA is well-formed. This requires that:
 *
 * 1. All roots have 0 bases (other than temselves)
 * 2. All leaves have 0 children
 * 3. All nodes reachable from roots have entries in parents and children entries
 * 4. All keys in parents/children are reachable from roots
 * 5. For all nodes N reachable from roots:
 *      5.1 parents.get(N) === direct bases of N
 *      5.2 M \in parents.get(N) <==> N \in children.get(M)
 *      5.3 children.get(N).size === 0 <==> N \in leaves
 * 6. All leaves are reachable from roots
 *
 * Note: The properties are checked out-of-order to avoid spurious exceptions on malformed CHAs.
 *
 * @param cha
 */
export function checkCHA(cha: CHA<ContractDefinition>): boolean {
    const reachable: Set<ContractDefinition> = new Set();

    // 1. All roots have 0 bases (other than temselves)
    if (!forAll(cha.roots, (n) => n.vLinearizedBaseContracts.length === 1)) {
        Logger.debug(`Not all roots (${pp(cha.roots)}) have 0 real bases in ${ppCHA(cha)}.`);
        return false;
    }

    let isOk = true;

    chaDFS(cha, (n) => {
        const parents = cha.parents.get(n);
        const children = cha.children.get(n);

        // 3. All nodes reachable from roots have entries in parents and children entries
        if (parents === undefined || children === undefined) {
            Logger.debug(`Parents or children entries missing for ${n.name} in ${ppCHA(cha)}.`);
            isOk = false;
            return;
        }

        reachable.add(n);

        const parentSet = new Set(parents);
        const directBases = new Set(
            n.vInheritanceSpecifiers.map(
                (inhSpec) => inhSpec.vBaseType.vReferencedDeclaration as ContractDefinition
            )
        );

        // 5. For all nodes N reachable from roots:
        //      5.1 parents.get(N) === direct bases of N
        if (!eq(parentSet, directBases)) {
            Logger.debug(
                `Parents for ${n.name} (${pp(parentSet)}) don't equal the direct bases (${pp(
                    directBases
                )}).`
            );
            isOk = false;
            return;
        }

        //      5.2 M \in parents.get(N) <==> N \in children.get(M)
        for (const parent of parents) {
            // Note: Cast is safe as we've already checked the parent has a children entry.
            const parentChildren = cha.children.get(parent) as Set<ContractDefinition>;
            if (!parentChildren.has(n)) {
                Logger.debug(
                    `Parent ${parent.name} for ${n.name} doesn't have ${n.name} in its children.`
                );
                isOk = false;
                return;
            }
        }

        //      5.3 children.get(N).size === 0 <==> N \in leaves
        if (children.size === 0) {
            if (!cha.leaves.has(n)) {
                Logger.debug(`Leaf ${n.name} is not in the leaves (${pp(cha.leaves)}).`);
                isOk = false;
                return;
            }
        }
    });

    if (!isOk) {
        return false;
    }

    // 4. All keys in parents/children are reachable from roots
    for (const key of cha.parents.keys()) {
        if (!reachable.has(key)) {
            Logger.debug(`Parent entry ${key.name} is not reachable.`);
            return false;
        }
    }

    for (const key of cha.children.keys()) {
        if (!reachable.has(key)) {
            Logger.debug(`Children entry ${key.name} is not reachable.`);
            return false;
        }
    }

    // 6. All leaves are reachable from roots
    if (!(intersection(cha.leaves, reachable).size === cha.leaves.size)) {
        Logger.debug(`Not all leaves are reachable.`);
        return false;
    }

    // 2. All leaves have 0 children
    if (!forAll(cha.leaves, (n) => (cha.children.get(n) as Set<ContractDefinition>).size === 0)) {
        Logger.debug(`Not all leaves have 0 children.`);
        return false;
    }

    return true;
}

export function getCHA(srcs: SourceUnit[]): CHA<ContractDefinition> {
    const parents: ParentMap<ContractDefinition> = new Map();
    const children: ChildrenMap<ContractDefinition> = new Map();

    for (const src of srcs) {
        for (const contract of src.vContracts) {
            children.set(contract, new Set());
        }
    }

    for (const src of srcs) {
        for (const contract of src.vContracts) {
            parents.set(
                contract,
                contract.vInheritanceSpecifiers.map(
                    (is) => is.vBaseType.vReferencedDeclaration as ContractDefinition
                )
            );

            for (const baseSpec of contract.vInheritanceSpecifiers) {
                const base = baseSpec.vBaseType.vReferencedDeclaration as ContractDefinition;
                getOr(children, base).add(contract);
            }
        }
    }

    const roots: Set<ContractDefinition> = new Set();
    const leaves: Set<ContractDefinition> = new Set();

    for (const [contract, directBases] of parents) {
        if (directBases.length === 0) {
            roots.add(contract);
        }
    }

    for (const [contract, childrenSet] of children) {
        if (childrenSet.size === 0) {
            leaves.add(contract);
        }
    }

    const res = { parents, children, roots, leaves };
    assert(checkCHA(res), `Built CHA ${res} is malformed`);
    return res;
}

/**
 * Walk over the class hierarchy `cha` in DFS order invoking `cb` for each node
 * @param cha
 * @param cb
 */
export function chaDFS<T>(cha: CHA<T>, cb: (node: T) => void): void {
    const seen: Set<T> = new Set();

    const dfs = (cur: T): void => {
        if (seen.has(cur)) {
            return;
        }

        seen.add(cur);
        cb(cur);

        const children = cha.children.get(cur);
        assert(
            children !== undefined,
            `Node ${pp(cur)} is missing from children map in ${ppCHA(cha)}`
        );
        children.forEach((child) => dfs(child));
    };

    cha.roots.forEach((root) => dfs(root));
}
