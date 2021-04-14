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
import { assert } from "../util/misc";

export function inCtx(arg: ASTNode | ASTNode[], ctx: ASTContext): boolean {
    if (arg instanceof ASTNode) {
        return ctx.contains(arg);
    }

    for (const node of arg) {
        if (!inCtx(node, ctx)) {
            return false;
        }
    }

    return true;
}

/**
 * Check that a single SourceUnit has a sane structure. This checks that:
 *
 *  - all reachable nodes belong to the same context, have their parent/sibling set correctly,
 *  - all number id properties of nodes point to a node in the same context
 *  - when a number property (e.g. `scope`) has a corresponding `v` prefixed property (e.g. `vScope`)
 *    check that the number proerty corresponds to the id of the `v` prefixed property.
 *  - most 'v' properties point to direct children of a node
 *
 * TODO: This code belongs in solc-typed-ast
 * NOTE: While this code can be slightly slow, its meant to be used mostly in testing so its
 * not performance critical.
 *
 * @param unit - source unit to check
 * @param ctxts - `ASTContext`s for each of the groups of units
 */
export function isSane(unit: SourceUnit, ctx: ASTContext): boolean {
    for (const child of unit.getChildren(true)) {
        assert(inCtx(child, ctx), `Node ${child.print()} is in wrong context.`);

        const immediateChildren = child.children;

        // Basic tree structure
        for (let i = 0; i < immediateChildren.length; i++) {
            const subChild = immediateChildren[i];

            if (subChild.parent !== child) {
                //`Node ${subChild.print()} has wrong parent.`
                return false;
            }
        }

        // Node specific checks
        /// ======== META NODES ==========================================
        if (child instanceof SourceUnit) {
            // Fix `exportedSymbols' and 'vExportedSymbols'
            for (const [name, symId] of child.exportedSymbols) {
                const symNode = ctx.locate(symId);

                if (symNode === undefined || symNode !== child.vExportedSymbols.get(name)) {
                    return false;
                }
            }
        } else if (child instanceof ImportDirective) {
            // Unfortunately due to compiler bugs in older compilers, when child.symbolAliases[i].foreign is a number
            // its invalid. When its an Identifier, only its name is valid.
            if (
                child.vSymbolAliases.length !== 0 &&
                child.vSymbolAliases.length !== child.symbolAliases.length
            ) {
                return false;
            }

            for (let i = 0; i < child.vSymbolAliases.length; i++) {
                const def = child.vSymbolAliases[i][0];

                if (!inCtx(def, ctx)) {
                    return false;
                }
            }

            // 'scope' and 'vScope'
            if (child.scope !== child.vScope.id || !inCtx(child.vScope, ctx)) {
                return false;
            }

            // 'sourceUnit' and 'vSourceUnit'
            if (child.sourceUnit !== child.vSourceUnit.id || !inCtx(child.vSourceUnit, ctx)) {
                return false;
            }
        } else if (child instanceof InheritanceSpecifier) {
            // Nothing to do
        } else if (child instanceof ModifierInvocation) {
            if (!inCtx(child.vModifier, ctx) || child.vModifier.name !== child.vModifierName.name) {
                return false;
            }
        } else if (child instanceof OverrideSpecifier) {
            // Nothing to do
        } else if (child instanceof ParameterList) {
            if (!inCtx(child.vParameters, ctx)) {
                //`vParameters in wrong context!`
                return false;
            }
        } else if (child instanceof PragmaDirective || child instanceof StructuredDocumentation) {
            // Nothing to do
        } else if (child instanceof UsingForDirective) {
            // Nothing to do
        } else if (child instanceof ContractDefinition) {
            /// ======== DECLARATION NODES ==========================================
            // 'scope' and 'vScope'
            if (
                child.scope !== child.vScope.id ||
                !inCtx(child.vScope, ctx) ||
                child.vScope !== child.parent
            ) {
                return false;
            }

            // linearizedBaseContracts and vLinearizedBaseContracts
            for (let i = 0; i < child.linearizedBaseContracts.length; i++) {
                if (
                    child.linearizedBaseContracts[i] !== child.vLinearizedBaseContracts[i].id ||
                    !inCtx(child.vLinearizedBaseContracts[i], ctx)
                ) {
                    return false;
                }
            }

            // documentation
            if (
                child.documentation instanceof StructuredDocumentation &&
                !inCtx(child.documentation, ctx)
            ) {
                return false;
            }
        } else if (child instanceof EnumDefinition) {
            if (!inCtx(child.vScope, ctx)) {
                //`vScope in wrong context!`
                return false;
            }
        } else if (child instanceof EnumValue) {
            // Nothing to do
        } else if (child instanceof EventDefinition) {
            if (
                child.documentation instanceof StructuredDocumentation &&
                !inCtx(child.documentation, ctx)
            ) {
                //`documentation in wrong context!`
                return false;
            }

            if (!inCtx(child.vScope, ctx)) {
                //`vScope in wrong context!`
                return false;
            }
        } else if (child instanceof FunctionDefinition) {
            // scope and vScope
            if (child.scope !== child.vScope.id || !inCtx(child.vScope, ctx)) {
                return false;
            }

            if (child.documentation instanceof StructuredDocumentation) {
                if (!inCtx(child.documentation, ctx)) {
                    //`documentation in wrong context!`
                    return false;
                }
            }
        } else if (child instanceof ModifierDefinition) {
            if (child.documentation instanceof StructuredDocumentation) {
                if (!inCtx(child.documentation, ctx)) {
                    //`documentation in wrong context!`
                    return false;
                }
            }

            if (!inCtx(child.vScope, ctx)) {
                //`vScope in wrong context!`
                return false;
            }
        } else if (child instanceof StructDefinition) {
            // scope and vScope
            if (child.scope !== child.vScope.id || !inCtx(child.vScope, ctx)) {
                return false;
            }
        } else if (child instanceof VariableDeclaration) {
            // scope and vScope
            if (child.scope !== child.vScope.id || !inCtx(child.vScope, ctx)) {
                return false;
            }

            if (child.documentation instanceof StructuredDocumentation) {
                if (!inCtx(child.documentation, ctx)) {
                    //`documentation in wrong context!`
                    return false;
                }
            }
        } else if (child instanceof Block) {
            /// ======== STATEMENT NODES ==========================================
            // Nothing to do
        } else if (child instanceof UncheckedBlock) {
            // Nothing to do
        } else if (child instanceof Break || child instanceof Continue) {
            // Nothing to do
        } else if (child instanceof DoWhileStatement) {
            // Nothing to do
        } else if (child instanceof EmitStatement) {
            if (!inCtx(child.vEventCall, ctx)) {
                //`vEventCall in wrong context!`
                return false;
            }
        } else if (child instanceof ExpressionStatement) {
            if (!inCtx(child.vExpression, ctx)) {
                //`vExpression in wrong context!`
                return false;
            }
        } else if (child instanceof ForStatement) {
            if (child.vInitializationExpression !== undefined) {
                if (!inCtx(child.vInitializationExpression, ctx)) {
                    //`vInitializationExpression in wrong context!`
                    return false;
                }
            }

            if (child.vCondition !== undefined) {
                if (!inCtx(child.vCondition, ctx)) {
                    //`vCondition in wrong context!`
                    return false;
                }
            }

            if (child.vLoopExpression !== undefined) {
                if (!inCtx(child.vLoopExpression, ctx)) {
                    //`vLoopExpression in wrong context!`
                    return false;
                }
            }

            if (!inCtx(child.vBody, ctx)) {
                //`vBody in wrong context!`
                return false;
            }
        } else if (child instanceof IfStatement) {
            if (!inCtx(child.vCondition, ctx)) {
                //`vCondition in wrong context!`
                return false;
            }
            if (!inCtx(child.vTrueBody, ctx)) {
                //`vTrueBody in wrong context!`
                return false;
            }
            if (child.vFalseBody !== undefined) {
                if (!inCtx(child.vFalseBody, ctx)) {
                    //`vFalseBody in wrong context!`
                    return false;
                }
            }
        } else if (child instanceof InlineAssembly) {
            // TODO: What to do about child.externalReferences here???
        } else if (child instanceof PlaceholderStatement) {
            // Nothing to do
        } else if (child instanceof Return) {
            // functionReturnParameters and vFunctionReturnParameters
            if (
                child.functionReturnParameters !== child.vFunctionReturnParameters.id ||
                !inCtx(child.vFunctionReturnParameters, ctx)
            ) {
                return false;
            }
        } else if (child instanceof Throw) {
            // Nothing to do
        } else if (child instanceof TryCatchClause) {
            // Nothing to do
        } else if (child instanceof TryStatement) {
            // Nothing to do
        } else if (child instanceof VariableDeclarationStatement) {
            // Nothing to do
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
            if (
                child.referencedDeclaration !== child.vReferencedDeclaration.id ||
                !inCtx(child.vReferencedDeclaration, ctx)
            ) {
                return false;
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
            // Nothing to do
        } else if (child instanceof FunctionCallOptions) {
            // Nothing to do
        } else if (child instanceof Identifier || child instanceof IdentifierPath) {
            if (
                child.referencedDeclaration !== null &&
                child.vReferencedDeclaration !== undefined &&
                (child.referencedDeclaration !== child.vReferencedDeclaration.id ||
                    !inCtx(child.vReferencedDeclaration, ctx))
            ) {
                return false;
            }
        } else if (child instanceof IndexAccess) {
            // Nothing to do
        } else if (child instanceof IndexRangeAccess) {
            // Nothing to do
        } else if (child instanceof Literal) {
            // Nothing to do
        } else if (child instanceof MemberAccess) {
            if (
                child.referencedDeclaration !== null &&
                child.vReferencedDeclaration !== undefined &&
                (child.referencedDeclaration !== child.vReferencedDeclaration.id ||
                    !inCtx(child.vReferencedDeclaration, ctx))
            ) {
                return false;
            }
        } else if (child instanceof NewExpression) {
            // Nothing to do
        } else if (child instanceof TupleExpression) {
            // Nothing to do
        } else if (child instanceof UnaryOperation) {
            if (!inCtx(child.vSubExpression, ctx)) {
                //`vSubExpression in wrong context!`
                return false;
            }
        } else {
            throw new Error(`Unknown ASTNode type ${child.constructor.name}`);
        }
    }

    return true;
}
