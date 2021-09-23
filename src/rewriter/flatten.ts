import {
    SourceUnit,
    ExportedSymbol,
    ImportDirective,
    ContractDefinition,
    FunctionDefinition,
    ASTNodeFactory,
    Identifier,
    IdentifierPath,
    UserDefinedTypeName,
    MemberAccess,
    StructDefinition,
    EnumDefinition,
    ErrorDefinition,
    VariableDeclaration,
    replaceNode,
    assert,
    PragmaDirective
} from "solc-typed-ast";
import { getFQName, getOrInit, topoSort } from "../util";

/**
 * When flattening units, we may introduce two definitions with the same name.
 * Rename definitions accordingly.
 *
 * @param units - units to flatten
 */
function fixNameConflicts(units: SourceUnit[]): Set<ExportedSymbol> {
    const nameMap = new Map<string, ExportedSymbol[]>();

    for (const unit of units) {
        unit.vContracts.forEach((contr) => getOrInit(contr.name, nameMap, []).push(contr));
        unit.vStructs.forEach((struct) => getOrInit(struct.name, nameMap, []).push(struct));
        unit.vEnums.forEach((enumDef) => getOrInit(enumDef.name, nameMap, []).push(enumDef));
        unit.vErrors.forEach((errDef) => getOrInit(errDef.name, nameMap, []).push(errDef));
        unit.vVariables.forEach((varDef) => getOrInit(varDef.name, nameMap, []).push(varDef));
        unit.vFunctions.forEach((funDef) => getOrInit(funDef.name, nameMap, []).push(funDef));
        unit.vImportDirectives.forEach((impDef) => {
            if (impDef.unitAlias !== "") getOrInit(impDef.unitAlias, nameMap, []).push(impDef);
        });
    }

    const renamed = new Set<ExportedSymbol>();

    for (const [, defs] of nameMap) {
        // Rename all defs after the first one
        for (let defIdx = 1; defIdx < defs.length; defIdx++) {
            const def = defs[defIdx];

            if (def instanceof ImportDirective) {
                def.unitAlias += `_${defIdx}`;
            } else {
                def.name += `_${defIdx}`;
            }

            renamed.add(def);
        }
    }

    return renamed;
}

/**
 * Sort contract definitions in topological order based on their inheritance.
 * Returns new array
 *
 * @param contracts - contracts to sort
 */
function sortContracts(contracts: ContractDefinition[]): ContractDefinition[] {
    // Partial order of contracts
    const order: Array<[ContractDefinition, ContractDefinition]> = [];

    for (const contract of contracts) {
        for (const base of contract.vLinearizedBaseContracts) {
            if (base !== contract) {
                order.push([base, contract]);
            }
        }
    }

    return order.length > 0 ? topoSort(contracts, order) : contracts;
}

/**
 * Given a list of `SourceUnit`s `units`, perform "flattening" of all imports to
 * allow the units to be concatenated into a single unit.
 * This involves several tasks:
 *
 * 1. Rename any top-level definitions with conflicting names
 * 2. For any `Identifier`, `IdentifierPath`, `UserDefinedTypeName` or
 *   `MemberAccess` referring to a renamed top-level definition fix the name to the renamed version
 * 3. For any `MemberAccess` that has a unit alias as its base (e.g. `Lib.Foo`
 *    where Lib comes from `import "..." as Lib`) convert it to an `Identifier`
 *    referring directly to the original imported definition (i.e. `Lib.Foo` -> `Foo`).
 * 4. Move all the modified top-level definitions in a new single SourceUnit. First place all non-contract definitions
 *    in any order, followed by all contracts sorted topologically by inheritance (i.e. bases first)
 * 5. Fix all broken vScopes to point to the correct source unit.
 * 6. Remove all import directives and solidity version pragmas
 * 7. Add a single compiler version pragma
 *
 * @param units - SourceUnits to flatten
 * @param factory - ASTNodeFactory used to build new unit
 * @param flatFileName - file name to be used for the new unit
 * @param version - compiler version to be used for the new unit
 */
export function flattenUnits(
    units: SourceUnit[],
    factory: ASTNodeFactory,
    flatFileName: string,
    version: string
): SourceUnit {
    const renamed = fixNameConflicts(units);

    for (const unit of units) {
        for (const refNode of unit.getChildrenBySelector(
            (node) =>
                node instanceof Identifier ||
                node instanceof IdentifierPath ||
                node instanceof UserDefinedTypeName ||
                node instanceof MemberAccess
        ) as Array<Identifier | IdentifierPath | UserDefinedTypeName | MemberAccess>) {
            const def = refNode.vReferencedDeclaration;

            // Only interested in references to exportable symbols
            if (
                def === undefined ||
                !(
                    def instanceof ContractDefinition ||
                    def instanceof StructDefinition ||
                    def instanceof EnumDefinition ||
                    def instanceof ErrorDefinition ||
                    def instanceof FunctionDefinition ||
                    (def instanceof VariableDeclaration && def.vScope instanceof SourceUnit)
                )
            ) {
                continue;
            }

            // Only interested in references to top-level symbols (they are the only ones affected by flattening)
            if (!(def.vScope instanceof SourceUnit)) {
                continue;
            }

            const fqName = getFQName(def, refNode);

            // Member accesses that have an unit import alias as a base need to be replaced with ids
            if (
                refNode instanceof MemberAccess &&
                refNode.vExpression instanceof Identifier &&
                refNode.vExpression.vReferencedDeclaration instanceof ImportDirective
            ) {
                replaceNode(refNode, factory.makeIdentifierFor(def));
            }

            // If we have:
            // 1. Identifiers other than "this"
            // 2. Identifier paths
            // 3. UserDefinedTypeNames with a name (the case when they have a path instead of name is handled in 2.)
            //
            // AND the original definition is part of the `renamed` set, or the name differs from the original def for other reasons,
            // fix the name of the node to the fully-qualified name.
            // TODO: (dimo): It's cleaner here to replace `Identifier` with `IdentifierPath` when `fqName` has dots in it.
            if (
                (refNode instanceof Identifier &&
                    !(
                        refNode.name === "this" &&
                        refNode.vReferencedDeclaration instanceof ContractDefinition
                    )) ||
                refNode instanceof IdentifierPath ||
                (refNode instanceof UserDefinedTypeName && refNode.name !== undefined)
            ) {
                if (renamed.has(def) || refNode.name !== def.name) {
                    refNode.name = fqName;
                }
            }
        }
    }

    for (const unit of units) {
        for (const imp of unit.vImportDirectives) {
            unit.removeChild(imp);
        }
    }

    const flatUnit = factory.makeSourceUnit(flatFileName, 0, flatFileName, new Map());
    let contracts: ContractDefinition[] = [];
    const pragmas = new Map<string, PragmaDirective[]>();

    for (const unit of units) {
        for (const def of unit.children) {
            // Skip import directives and compiler pragmas
            if (
                def instanceof ImportDirective ||
                (def instanceof PragmaDirective && def.vIdentifier === "solidity")
            ) {
                continue;
            }

            if (def instanceof ContractDefinition) {
                contracts.push(def);
            } else if (def instanceof PragmaDirective) {
                if (!pragmas.has(def.vIdentifier)) {
                    pragmas.set(def.vIdentifier, [def]);
                } else {
                    (pragmas.get(def.vIdentifier) as PragmaDirective[]).push(def);
                }
            } else {
                flatUnit.appendChild(def);
            }
        }
    }

    contracts = sortContracts(contracts);

    for (const def of contracts) {
        flatUnit.appendChild(def);
    }

    flatUnit.acceptChildren();

    for (const nd of flatUnit.getChildrenBySelector(
        (nd) =>
            nd instanceof ContractDefinition ||
            nd instanceof StructDefinition ||
            nd instanceof FunctionDefinition ||
            nd instanceof VariableDeclaration ||
            nd instanceof ImportDirective
    ) as Array<
        | ContractDefinition
        | StructDefinition
        | FunctionDefinition
        | VariableDeclaration
        | ImportDirective
    >) {
        if (nd.vScope instanceof SourceUnit && nd.vScope !== flatUnit) {
            nd.scope = flatUnit.id;
        }
    }

    // Finally insert a single compiler version directive
    flatUnit.insertAtBeginning(factory.makePragmaDirective(["solidity", version]));

    for (const [name, pragmaDefs] of pragmas) {
        for (const def of pragmaDefs) {
            assert(
                def.vValue === pragmaDefs[0].vValue,
                `Cannot flatten conflicting pragmas 'pragma ${name} ${def.vValue}' and 'pragma ${name} ${pragmaDefs[0].vValue}'`
            );
        }

        flatUnit.insertAtBeginning(pragmaDefs[0]);
    }

    return flatUnit;
}
