import {
    ArrayTypeName,
    Assignment,
    ASTContext,
    ASTNode,
    BinaryOperation,
    Block,
    Break,
    Conditional,
    Continue,
    ContractDefinition,
    DoWhileStatement,
    ElementaryTypeName,
    ElementaryTypeNameExpression,
    EmitStatement,
    EnumDefinition,
    EnumValue,
    EventDefinition,
    ExpressionStatement,
    ForStatement,
    FunctionCall,
    FunctionCallOptions,
    FunctionDefinition,
    FunctionTypeName,
    Identifier,
    IdentifierPath,
    IfStatement,
    ImportDirective,
    IndexAccess,
    IndexRangeAccess,
    InheritanceSpecifier,
    InlineAssembly,
    Literal,
    Mapping,
    MemberAccess,
    ModifierDefinition,
    ModifierInvocation,
    NewExpression,
    OverrideSpecifier,
    ParameterList,
    PlaceholderStatement,
    PragmaDirective,
    Return,
    SourceUnit,
    StructDefinition,
    StructuredDocumentation,
    Throw,
    TryCatchClause,
    TryStatement,
    TupleExpression,
    UnaryOperation,
    UncheckedBlock,
    UserDefinedTypeName,
    UsingForDirective,
    VariableDeclaration,
    VariableDeclarationStatement,
    WhileStatement
} from "solc-typed-ast";
import { assert, getOrInit } from "../util/misc";

/**
 * Given 2 ASTNodes with **identical** structure, build a mapping from the
 * ids of the nodes in the first one (`from`) to the ids of the corresponding
 * nodes in the second (`to`)
 *
 * @param from - original source unit
 * @param to - target source unit
 * @param m - map we are building
 */
function buildMap(from: ASTNode, to: ASTNode, m: Map<number, number>): void {
    assert(from.constructor.name === to.constructor.name, `Internal error: Mismatch in node types`);
    const fromChildren = from.children;
    const toChildren = to.children;

    assert(
        fromChildren.length === toChildren.length,
        `Internal error: Mismatch in number of children`
    );

    m.set(from.id, to.id);

    for (let i = 0; i < fromChildren.length; i++) {
        buildMap(fromChildren[i], toChildren[i], m);
    }
}

/**
 * Given a list of groups of `SourceUnits` `units` and their corresponding `ASTContexts` `ctxts`
 * unify all the source units into a new single context. Note that:
 *  1. the same `SourceUnit` may appear in multiple groups. It should appear only once in the
 *      unified group of `SourceUnit`s
 *  2. This involves re-numbering the ids of ALL ASTNodes to avoid conflicts
 *  3. This requires us to change all id-based cross references in the AST. This involves changing
 *  both raw 'id' properties (e.g. `scope`) and their corresponding computed properties (e.g. `vScope`).
 *
 *  TODO: Changing the computed properties can be removed from here, if we add a `refresh` method to all ASTNodes
 *  TODO: This logic belongs in solc-typed-ast
 *
 * @param groups - groups of `SourceUnit`'s
 * @param ctxts - `ASTContext`s for each of the groups of units
 */
export function merge(groups: SourceUnit[][]): [SourceUnit[], ASTContext] {
    // Map from absolutePaths to all the units with the same absolute path.
    const pathMap = new Map<string, SourceUnit[]>();
    // Map from SourceUnits to their original ASTContexts. This map only contains
    // nodes for which we change the context (i.e. the representatives)
    const oldCtxMap = new Map<SourceUnit, ASTContext>();
    // 2-level map, from ASTContexts to a map from Ids in a given context, to
    // the ids of the corrseponding node in newCtxt
    const reNumberMap = new Map<ASTContext, Map<number, number>>();

    // Build the groups of duplicate units
    groups.forEach((group) => {
        for (const unit of group) {
            getOrInit(unit.absolutePath, pathMap, []).push(unit);
        }
    });

    // The set of representative SourceUnits
    const representatives: SourceUnit[] = [];
    // The new merged context
    const newCtxt = new ASTContext();

    let nNodes = 0;

    // Stage 1: Pick a 'representative' `SourceUnit` from each group,
    // re-number all its nodes in a new id-space and add them to `newCtxt`
    for (const [, group] of pathMap) {
        const representative = group[0];
        const oldRepresentativeCtx = representative.requiredContext;
        oldCtxMap.set(representative, oldRepresentativeCtx);

        representatives.push(representative);

        // Re-number and register in new context
        for (const child of representative.getChildren(true)) {
            const oldId = child.id;
            const newId = nNodes++;

            child.context?.unregister(child);

            child.id = newId;

            newCtxt.register(child);

            getOrInit(oldRepresentativeCtx, reNumberMap, new Map()).set(oldId, newId);
        }

        // Build the mapping for the nodes in all other duplicate units into this group,
        // into the new id space.
        for (const duplicate of group.slice(1)) {
            assert(duplicate.requiredContext !== oldRepresentativeCtx, `Internal Error.`);
            buildMap(
                duplicate,
                representative,
                getOrInit(duplicate.requiredContext, reNumberMap, new Map())
            );
        }
    }

    // Helper: Get the original context for a given source unit
    const getOldCtx = (n: SourceUnit): ASTContext => {
        const res = oldCtxMap.get(n);
        if (res === undefined) {
            return n.requiredContext;
        }

        return res;
    };

    const hasMapping = (n: number, oldCtx: ASTContext): boolean => {
        const idMap = reNumberMap.get(oldCtx);
        assert(idMap !== undefined, `Missing id map for ASTContext#${oldCtx.id}`);
        return idMap.has(n);
    };

    // Stage 2: Fix up all node properties that depend on node ids
    for (const unit of representatives) {
        const oldUnitCtx: ASTContext = getOldCtx(unit);

        // Helper: Given a node id from oldUnitCtx find its corresponding node id in newCtxt
        const getNew = (n: number): ASTNode => {
            const idMap = reNumberMap.get(oldUnitCtx);
            assert(idMap !== undefined, `Missing id map for ASTContext#${oldUnitCtx.id}`);
            const newId = idMap.get(n);
            assert(newId !== undefined, `Missing id ${n} in map for ASTContext#${oldUnitCtx.id}`);
            return newCtxt.require(newId);
        };

        for (const child of unit.getChildren(true)) {
            /// ======== META NODES ==========================================
            if (child instanceof SourceUnit) {
                // Fix `exportedSymbols' and 'vExportedSymbols'
                for (const [name, symId] of child.exportedSymbols) {
                    child.exportedSymbols.set(name, getNew(symId).id);
                }
            } else if (child instanceof ImportDirective) {
                // Fix 'scope' and 'vScope'
                child.scope = getNew(child.scope).id;

                // Fix 'sourceUnit' and 'vSourceUnit'
                child.sourceUnit = getNew(child.sourceUnit).id;

                // Fix vSymbolAliases and symbolAliases (only if vSymbolAliases is filled in).
                for (let i = 0; i < child.symbolAliases.length; i++) {
                    const foreign = child.symbolAliases[i].foreign;

                    if (!(foreign instanceof Identifier)) {
                        // The foreign id is invalid since this is an older compiler version,
                        // and we haven't re-built the id-map. This happens when the user
                        // has submited an old compiler AST without source code.
                        continue;
                    } else {
                        // import directives identifier's referencedDeclaration
                        // is null or undefined (depending on version) from the
                        // compiler. Nothing to do here.
                        assert(
                            foreign.referencedDeclaration === undefined ||
                                foreign.referencedDeclaration === null ||
                                foreign.referencedDeclaration === -1,
                            `Unexpected non-null foreign reference declaration: ${foreign.referencedDeclaration} in imported symbol ${foreign.name} from ${child.file}`
                        );
                    }
                }
            } else if (child instanceof InheritanceSpecifier) {
                // Nothing to do...
            } else if (child instanceof ModifierInvocation) {
                // Nothing to do (update to vModifierName is done in the Identifier Case).
            } else if (child instanceof OverrideSpecifier) {
                // Nothing to do...
            } else if (child instanceof ParameterList) {
                // Nothing to do...
            } else if (
                child instanceof PragmaDirective ||
                child instanceof StructuredDocumentation
            ) {
                // Nothing to do
            } else if (child instanceof UsingForDirective) {
                // Nothing to do...
            } else if (child instanceof ContractDefinition) {
                /// ======== DECLARATION NODES ==========================================
                // Scope
                child.scope = getNew(child.scope).id;

                // linearizedBaseContracts and vLinearizedBaseContracts
                for (let i = 0; i < child.linearizedBaseContracts.length; i++) {
                    const newBase = getNew(child.linearizedBaseContracts[i]);
                    child.linearizedBaseContracts[i] = newBase.id;
                }
            } else if (child instanceof EnumDefinition) {
                // Nothing to do...
            } else if (child instanceof EnumValue) {
                // Nothing to do
            } else if (child instanceof EventDefinition) {
                // Nothing to do
            } else if (child instanceof FunctionDefinition) {
                // scope
                child.scope = getNew(child.scope).id;
            } else if (child instanceof ModifierDefinition) {
                // Nothing to do
            } else if (child instanceof StructDefinition) {
                // scope
                child.scope = getNew(child.scope).id;
            } else if (child instanceof VariableDeclaration) {
                // scope
                child.scope = getNew(child.scope).id;
            } else if (child instanceof Block) {
                /// ======== STATEMENT NODES ==========================================
                // Nothing to do...
            } else if (child instanceof UncheckedBlock) {
                // Nothing to do
            } else if (child instanceof Break || child instanceof Continue) {
                // Nothing to do
            } else if (child instanceof DoWhileStatement) {
                // Nothing to do
            } else if (child instanceof EmitStatement) {
                // Nothing to do
            } else if (child instanceof ExpressionStatement) {
                // Nothing to do
            } else if (child instanceof ForStatement) {
                // Nothing to do
            } else if (child instanceof IfStatement) {
                // Nothing to do
            } else if (child instanceof InlineAssembly) {
                // TODO: What to do about child.externalReferences here???
            } else if (child instanceof PlaceholderStatement) {
                // Nothing to do
            } else if (child instanceof Return) {
                // functionReturnParameters
                child.functionReturnParameters = getNew(child.functionReturnParameters).id;
            } else if (child instanceof Throw) {
                // Nothing to do
            } else if (child instanceof TryCatchClause) {
                // Nothing to do
            } else if (child instanceof TryStatement) {
                // Nothing to do
            } else if (child instanceof VariableDeclarationStatement) {
                for (let i = 0; i < child.assignments.length; i++) {
                    const assignment = child.assignments[i];

                    if (assignment === null) {
                        continue;
                    }

                    child.assignments[i] = getNew(assignment).id;
                }
            } else if (child instanceof WhileStatement) {
                // Nothing to do
            } else if (child instanceof ArrayTypeName) {
                /// ======== TYPE NODES ==========================================
                // Nothing to do
            } else if (child instanceof ElementaryTypeName) {
                // nothing to do
            } else if (child instanceof FunctionTypeName) {
                // Nothing to do
            } else if (child instanceof Mapping) {
                // Nothing to do
            } else if (child instanceof UserDefinedTypeName) {
                if (child.vReferencedDeclaration !== null && child.referencedDeclaration >= 0) {
                    child.referencedDeclaration = getNew(child.referencedDeclaration).id;
                }
            } else if (child instanceof Assignment) {
                /// ======== EXPRESION NODES ==========================================
                // Nothing to do
            } else if (child instanceof BinaryOperation) {
                // Nothing to do
            } else if (child instanceof Conditional) {
                // Nothing to do
            } else if (child instanceof ElementaryTypeNameExpression) {
                // Nothing to do
            } else if (child instanceof FunctionCall) {
                // Nothing to do - this will be fixed when walking child.vExpression
            } else if (child instanceof FunctionCallOptions) {
                // Nothing to do
            } else if (child instanceof Identifier || child instanceof IdentifierPath) {
                // Note that identifiers under import directives can have null referencedDeclaration
                if (child.referencedDeclaration !== null && child.referencedDeclaration > 0) {
                    // Note we can't rely on child.vIdentifierType, since it relies on child.vReferencedDeclaration which
                    // relies on child.referencedDeclaration which is not set. So we need to manually check if this is builtin.
                    const isBuiltin = !hasMapping(child.referencedDeclaration, oldUnitCtx);

                    child.referencedDeclaration = isBuiltin
                        ? -1
                        : getNew(child.referencedDeclaration).id;
                }
            } else if (child instanceof IndexAccess) {
                // Nothing to do
            } else if (child instanceof IndexRangeAccess) {
                // Nothing to do
            } else if (child instanceof Literal) {
                // Nothing to do
            } else if (child instanceof MemberAccess) {
                if (child.referencedDeclaration > 0) {
                    // Again here we have to manually check if its invalid
                    const isBuiltin = !hasMapping(child.referencedDeclaration, oldUnitCtx);

                    child.referencedDeclaration = isBuiltin
                        ? -1
                        : getNew(child.referencedDeclaration).id;
                }
            } else if (child instanceof NewExpression) {
                // Nothing to do
            } else if (child instanceof TupleExpression) {
                // Nothing to do - this will be fixed when walking child.vOriginalComponents
            } else if (child instanceof UnaryOperation) {
                // Nothing to do
            } else {
                throw new Error(`Unknown ASTNode type ${child.constructor.name}`);
            }
        }
    }

    return [representatives, newCtxt];
}
