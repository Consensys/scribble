import {
    ArrayTypeName,
    Assignment,
    ASTNodeFactory,
    Block,
    ContractDefinition,
    DataLocation,
    DoWhileStatement,
    Expression,
    ExpressionStatement,
    ExternalReferenceType,
    ForStatement,
    FunctionCall,
    FunctionCallKind,
    FunctionDefinition,
    FunctionKind,
    FunctionStateMutability,
    FunctionVisibility,
    Identifier,
    IfStatement,
    IndexAccess,
    Mapping,
    MemberAccess,
    Mutability,
    Statement,
    StateVariableVisibility,
    StructDefinition,
    TupleExpression,
    TypeName,
    UnaryOperation,
    UncheckedBlock,
    UserDefinedTypeName,
    VariableDeclaration,
    WhileStatement
} from "solc-typed-ast";
import { AnnotationMetaData, replaceNode } from ".";
import {
    AnnotationMap,
    ConcreteDatastructurePath,
    decomposeLHS,
    generateExpressions,
    generateTypeAst,
    getOrInit,
    getTypeLocation,
    insertInvChecks,
    isStateVarRef,
    isTypeAliasable,
    pp,
    PropertyMetaData,
    single,
    StateVarUpdateLoc,
    StateVarUpdateNode,
    updateMap
} from "..";
import { assert } from "../util";
import { InstrumentationContext } from "./instrumentation_context";
import { parse as parseTypeString } from "../spec-lang/typeString_parser";
import { TranspilingContext } from "./transpiling_context";
import {
    SAddressType,
    SArrayType,
    SBoolType,
    SBytes,
    SFixedBytes,
    SId,
    SIfUpdated,
    SIntLiteralType,
    SIntType,
    SMappingType,
    SPointer,
    SStateVarProp,
    SString,
    STupleType,
    SType,
    SUserDefinedType
} from "../spec-lang/ast";
import { SStringLiteralType } from "../spec-lang/ast/types/string_literal";
import { astTypeNameToSType } from "../spec-lang/tc";
import { makeTypeString } from "./type_string";
import { cook } from "../rewriter";
import { getOrAddConstructor } from "./instrument";

/**
 * Given a Solidity `Expression` `e` and the `expectedType` where its being used,
 * compute the actual `SType` of `e`. This may be different from `expectedType` due to implicit
 * casts.
 *
 * Note: We only need `expectedType` here due to limitation in typeString parsing in the case
 * of int literals. This function should be removed after we add "get type of arbitrary expression" to
 * solc-typed-ast.
 *
 * @param e
 * @param expectedType
 */
function getExprSType(e: Expression, expectedType?: SType): SType {
    /**
     * Sanitize the parsed `actualType` by replacing any int_const types with the
     * concrete integer type expected at that location, and any string literal types with
     * `string memory`. Note this code makes the assumption that int literals and string literal
     * types CANNOT show up inside array/mapping types (which I think is true?).
     *
     * @param actualType
     * @param expectedType
     */
    const sanitizeType = (actualType: SType, expectedType: SType): SType => {
        if (actualType instanceof SIntLiteralType) {
            assert(
                expectedType instanceof SIntType,
                `Expected ${expectedType.pp()} got ${actualType.pp()}`
            );
            return expectedType;
        }

        if (actualType instanceof SStringLiteralType) {
            return new SPointer(new SString(), DataLocation.Memory);
        }

        if (actualType instanceof STupleType) {
            assert(
                expectedType instanceof STupleType &&
                    expectedType.elements.length === actualType.elements.length,
                `Expected ${expectedType.pp()} got ${actualType.pp()}`
            );

            return new STupleType(
                actualType.elements.map((el, i) => sanitizeType(el, expectedType.elements[i]))
            );
        }

        return actualType;
    };

    const parsedType: SType = parseTypeString(e.typeString);

    return expectedType !== undefined ? sanitizeType(parsedType, expectedType) : parsedType;
}

export function getKeysAndCompTypes(
    factory: ASTNodeFactory,
    varDecl: VariableDeclaration,
    path: ConcreteDatastructurePath
): [Array<[TypeName, Expression] | string>, TypeName] {
    let typ = varDecl.vType as TypeName;
    const keyTypes: Array<[TypeName, Expression] | string> = [];

    for (const comp of path) {
        if (comp instanceof Expression) {
            if (typ instanceof ArrayTypeName) {
                keyTypes.push([factory.makeElementaryTypeName("<missing>", "uint256"), comp]);
                typ = typ.vBaseType;
            } else {
                assert(typ instanceof Mapping, ``);
                keyTypes.push([typ.vKeyType, comp]);
                typ = typ.vValueType;
            }
        } else {
            assert(
                typ instanceof UserDefinedTypeName &&
                    typ.vReferencedDeclaration instanceof StructDefinition,
                ``
            );

            typ = single(
                typ.vReferencedDeclaration.vMembers.filter((member) => member.name === comp)
            ).vType as TypeName;

            keyTypes.push(comp);
        }
    }

    return [keyTypes, typ];
}

const assignSuffixMap: { [key: string]: string } = {
    "=": "assign",
    "|=": "or_assign",
    "^=": "not_assign",
    "&=": "and_assign",
    "<<=": "bsl_assign",
    ">>=": "bsr_assign",
    "+=": "plus_assign",
    "-=": "minus_assign",
    "*=": "mul_assign",
    "/=": "div_assign",
    "%=": "mod_assign"
};

/**
 * Get a string descriptor for a type to be used in naming conventions
 * @param typ
 */
function getTypeDescriptor(typ: SType): string {
    if (typ instanceof SAddressType) {
        return `address${typ.payable ? "_payable" : ""}`;
    }

    if (typ instanceof SArrayType) {
        const baseStr = getTypeDescriptor(typ.elementT);
        return `arr_${baseStr}${typ.size ? "_" + typ.size : ""}`;
    }

    if (typ instanceof SBoolType) {
        return `bool`;
    }

    if (typ instanceof SBytes) {
        return `bytes`;
    }

    if (typ instanceof SFixedBytes) {
        return `bytes_${typ.size}`;
    }

    if (typ instanceof SIntType) {
        return (typ.signed ? "" : "u") + `int${typ.nBits}`;
    }

    if (typ instanceof SMappingType) {
        return `mapping_${getTypeDescriptor(typ.keyType)}_${getTypeDescriptor(typ.valueType)}`;
    }

    if (typ instanceof SPointer) {
        return `ptr_${getTypeDescriptor(typ.to)}_${typ.location}`;
    }

    if (typ instanceof SString) {
        return `string`;
    }

    if (typ instanceof SUserDefinedType) {
        return `ud_${typ.name.replace(".", "_")}`;
    }

    throw new Error(`NYI type descriptor for ${typ.pp()}`);
}

/**
 * Compute the name of the wrapper function for a given `updateNode`. `updateNode` must only update
 * a single state variable (tuple assignments are handled separately).
 *
 * The name encodes the following:
 *  - the contract name and state var name
 *  - the datastructure path inside the state var if only a part of it is updated
 *  - the types of the arguments (key/array indices). This is done to avoid dealing with casting and introducing extra memory copies.
 *    Note that as a result we may get multiple wrappers for the same var/var path due to implicit casts
 *  - the type of the new value being assigned/pushed (if any)
 *  - the kind of update node this is - pop, push, push without arg, assignment, delete, pre/post fix inc/dec
 * @param updateNode
 * @param varDecl
 * @param path
 * @param additionalArgs
 */
function getWrapperName(
    updateNode: Assignment | FunctionCall | UnaryOperation | VariableDeclaration,
    varDecl: VariableDeclaration,
    path: Array<string | [TypeName, Expression]>,
    additionalArgs: Array<[Expression, TypeName]>
): string {
    const defContract = varDecl.vScope as ContractDefinition;
    const pathString = path
        .map((el) => {
            if (typeof el === "string") {
                return el;
            }
            const [expectedTyp, expr] = el;

            const exprT = getExprSType(expr, astTypeNameToSType(expectedTyp));
            return `idx_${getTypeDescriptor(exprT)}`;
        })
        .join("_");
    const additionalArgsString = additionalArgs
        .map(([expr, typ]) => getTypeDescriptor(getExprSType(expr, astTypeNameToSType(typ))))
        .join("_");

    let suffix: string;

    if (updateNode instanceof Assignment) {
        //'=' | '|=' | '^=' | '&=' | '<<=' | '>>=' | '+=' | '-=' | '*=' | '/=' | '%='
        suffix = assignSuffixMap[updateNode.operator];
    } else if (updateNode instanceof FunctionCall) {
        suffix = updateNode.vFunctionName;
        if (suffix === "push" && updateNode.vArguments.length === 0) {
            suffix += "_noarg";
        }
    } else if (updateNode instanceof VariableDeclaration) {
        suffix = "inline_initializer";
    } else {
        if (updateNode.operator === "delete") {
            suffix = "delete";
        } else {
            suffix = updateNode.operator === "++" ? "inc" : "dec";
            suffix += "_" + (updateNode.prefix ? "_prefix" : "_postfix");
        }
    }

    let res = `${defContract.name}_${varDecl.name}_`;

    if (pathString !== "") {
        res += pathString + "_";
    }

    if (additionalArgsString !== "") {
        res += additionalArgsString + "_";
    }

    return res + suffix;
}

/**
 * Helper to decompose a `Statement` that updates a SINGLE state variable into
 * a tuple `[varExp, additionalArgs]` where `varExp` is the actual expression
 * that is being updated (either a reference to the state var itself or some
 * part of it) and `additionalArgs` is an array includes the new value being
 * assigned/pushed and its type (if there is such a value).
 *
 * @param updateNode
 * @param factory
 */
function decomposeStateVarUpdated(
    updateNode: Assignment | FunctionCall | UnaryOperation,
    factory: ASTNodeFactory
): [Expression, Array<[Expression, TypeName]>] {
    let stateVarExp: Expression;
    const additionalArgs: Array<[Expression, TypeName]> = [];

    if (updateNode instanceof FunctionCall) {
        const callee = updateNode.vFunctionName;
        assert(
            (updateNode.vFunctionCallType === ExternalReferenceType.Builtin && callee === "push") ||
                callee === "pop",
            ""
        );

        if (callee === "push" && updateNode.vArguments.length === 0) {
            // There is a weird edge case where `.push()` returns a refernce that can be updated.
            // E.g.: `arr.push() = 10;`.
            // Is tricky to support this so for now throw if we see it used this way
            const pt = updateNode.parent;
            assert(
                !(
                    pt instanceof MemberAccess ||
                    pt instanceof IndexAccess ||
                    (pt instanceof Assignment && pt.vLeftHandSide.children.includes(updateNode))
                ),
                "Scribble doesn't support instrumenting assignments to .push()."
            );
        }

        stateVarExp = (updateNode.vExpression as MemberAccess).vExpression;

        if (callee == "push" && updateNode.vArguments.length > 0) {
            const [baseExp, path] = decomposeLHS(stateVarExp);
            assert(isStateVarRef(baseExp), ``);
            const [, compT] = getKeysAndCompTypes(
                factory,
                baseExp.vReferencedDeclaration as VariableDeclaration,
                path
            );
            assert(compT instanceof ArrayTypeName, ``);
            additionalArgs.push([single(updateNode.vArguments), compT.vBaseType]);
        }
    } else if (updateNode instanceof UnaryOperation) {
        stateVarExp = updateNode.vSubExpression;
    } else {
        assert(!(updateNode.vLeftHandSide instanceof TupleExpression), `NYI`);
        stateVarExp = updateNode.vLeftHandSide;
        const [baseExp, path] = decomposeLHS(stateVarExp);
        assert(isStateVarRef(baseExp), ``);
        const [, compT] = getKeysAndCompTypes(
            factory,
            baseExp.vReferencedDeclaration as VariableDeclaration,
            path
        );
        additionalArgs.push([updateNode.vRightHandSide, compT]);
    }

    return [stateVarExp, additionalArgs];
}

/**
 * Helper function that does a lot of the work of wrapping a single
 * state variable update statement in a wrapper function. It:
 *
 * 1. Generates a wrapper function
 * 2. Finds all of the key expressions used in `stateVarNode` and replaces those with arguments
 * 3. Replaces the `newValNode` expression (if any) with an argument
 * 4. Generates a call to the wrapper
 *
 * @param ctx - instrumentation context
 * @param updateNode - the node that we are wrapping
 * @param stateVarExp - the SUBexpression in `updateNode` that corresponds to the component of a state variable being modified
 * @param newValExp - the SUBexpression in `updateNode` that corresponds to a new value (if any - e.g. delete x; doesn't have a new value)
 */
function makeWrapper(
    ctx: InstrumentationContext,
    updateNode: Assignment | FunctionCall | UnaryOperation
): FunctionDefinition {
    const factory = ctx.factory;
    // Work on a copy of updateNode, as we will modify it destructively
    // and put it inside the body of the wrapper
    updateNode = factory.copy(updateNode);

    // Decomposing is a 2 step process.
    // 1) Call decomposeStateVarUpdated to decompose the various update statements - assignments, function calls, unaries..
    const [stateVarExp, additionalArgs] = decomposeStateVarUpdated(updateNode, factory);
    // 2) Call decomposeLHS to identify the actuall state variable, and the path of the part of it which is updated
    const [baseExp, path] = decomposeLHS(stateVarExp);
    assert(isStateVarRef(baseExp), ``);

    const varDecl = baseExp.vReferencedDeclaration as VariableDeclaration;
    const [pathIdxTs] = getKeysAndCompTypes(
        factory,
        baseExp.vReferencedDeclaration as VariableDeclaration,
        path
    );

    const definingContract = varDecl.vScope as ContractDefinition;
    const funName = getWrapperName(updateNode, varDecl, pathIdxTs, additionalArgs);

    // Check if we have already built a wrapper for this variable/path/update type. Otherwise build one now.
    const cached = ctx.getWrapper(definingContract, funName);
    if (cached !== undefined) {
        return cached;
    }

    const formalParamTs: SType[] = [];
    const replMap = new Map<number, number>();

    for (const pathEl of pathIdxTs) {
        if (typeof pathEl === "string") {
            continue;
        }

        const [keyT, keyExp] = pathEl;
        replMap.set(keyExp.id, formalParamTs.length);
        const exprT = getExprSType(keyExp, astTypeNameToSType(keyT));
        formalParamTs.push(exprT);
    }

    for (const [actual, formalT] of additionalArgs) {
        replMap.set(actual.id, formalParamTs.length);
        const exprT = getExprSType(actual, astTypeNameToSType(formalT));
        formalParamTs.push(exprT);
    }

    const wrapperFun = factory.makeFunctionDefinition(
        definingContract.id,
        FunctionKind.Function,
        funName,
        false,
        FunctionVisibility.Internal,
        FunctionStateMutability.NonPayable,
        false,
        factory.makeParameterList([]),
        factory.makeParameterList([]),
        [],
        undefined,
        factory.makeBlock([]),
        ``
    );

    definingContract.appendChild(wrapperFun);
    ctx.setWrapper(definingContract, funName, wrapperFun);
    const body = wrapperFun.vBody as Block;

    for (let i = 0; i < formalParamTs.length; i++) {
        const formalT = formalParamTs[i];

        wrapperFun.vParameters.appendChild(
            factory.makeVariableDeclaration(
                false,
                false,
                ctx.nameGenerator.getFresh(`ARG`),
                wrapperFun.vParameters.id,
                false,
                getTypeLocation(formalT),
                StateVariableVisibility.Default,
                Mutability.Mutable,
                "<missing>",
                undefined,
                generateTypeAst(formalT, factory)
            )
        );
    }

    for (const [nodeId, argIdx] of replMap.entries()) {
        const node = updateNode.requiredContext.locate(nodeId);
        replaceNode(node, factory.makeIdentifierFor(wrapperFun.vParameters.vParameters[argIdx]));
    }

    const retParamTs: SType[] = [];
    // Add the re-written update node in the body of the wrapper
    const updateNodeStmt = factory.makeExpressionStatement(updateNode);
    body.appendChild(updateNodeStmt);
    ctx.addGeneralInstrumentation(updateNodeStmt);

    // Add any return parameters if needed
    if (updateNode instanceof UnaryOperation) {
        if (["++", "--"].includes(updateNode.operator)) {
            const retT = getExprSType(updateNode);
            assert(retT instanceof SIntType, ``);
            retParamTs.push(retT);
        }
    } else if (updateNode instanceof Assignment) {
        const retT = getExprSType(updateNode.vLeftHandSide);
        assert(
            !(retT instanceof STupleType),
            `makeWrapper should only be invoked on primitive assignments.`
        );
        retParamTs.push(retT);
    }

    for (let i = 0; i < retParamTs.length; i++) {
        const formalT = retParamTs[i];
        // @todo Is this hack correct?
        const loc = formalT instanceof SPointer ? formalT.location : DataLocation.Default;
        const solFromalT = generateTypeAst(formalT, factory);

        const decl = factory.makeVariableDeclaration(
            false,
            false,
            ctx.nameGenerator.getFresh(`RET`),
            wrapperFun.vParameters.id,
            false,
            loc,
            StateVariableVisibility.Default,
            Mutability.Mutable,
            "<missing>",
            undefined,
            solFromalT
        );

        ctx.addGeneralInstrumentation(decl);
        wrapperFun.vReturnParameters.appendChild(decl);
    }

    // Add the actual return statements (assignments) if we have return parameters
    if (retParamTs.length > 0) {
        assert(
            updateNode instanceof Assignment ||
                (updateNode instanceof UnaryOperation &&
                    ["++", "--"].includes(updateNode.operator)),
            `Only assignments and ++/-- return values. Not: ${pp(updateNode)}`
        );

        const value = factory.copy(stateVarExp);
        const retStmt = factory.makeExpressionStatement(
            factory.makeAssignment(
                "<missing>",
                "=",
                factory.makeIdentifierFor(single(wrapperFun.vReturnParameters.vParameters)),
                value
            )
        );
        ctx.addGeneralInstrumentation(retStmt);

        if (updateNode instanceof UnaryOperation && ["++", "--"].includes(updateNode.operator)) {
            if (updateNode.prefix) {
                body.appendChild(retStmt);
            } else {
                body.insertBefore(retStmt, body.children[0]);
            }
        } else {
            assert(updateNode instanceof Assignment, ``);
            body.appendChild(retStmt);
        }
    }

    return wrapperFun;
}

/**
 * Given the expression `e` make sure that `e` is contained in an `ExpressionStatement`, which itself
 * is contained in a `Block`. There are several cases where we may need to create the block itself
 * @param e
 * @param factory
 */
function ensureToplevelExprInBlock(e: Expression, factory: ASTNodeFactory): void {
    assert(e.parent instanceof ExpressionStatement, ``);
    const container = e.parent.parent;
    if (container instanceof Block || container instanceof UncheckedBlock) {
        return;
    }

    if (container instanceof IfStatement) {
        if (container.vTrueBody === e.parent) {
            container.vTrueBody = factory.makeBlock([e.parent]);
        } else {
            assert(container.vFalseBody === e.parent, ``);
            container.vFalseBody = factory.makeBlock([e.parent]);
        }
        return;
    }

    if (container instanceof ForStatement) {
        assert(
            container.vBody === e.parent,
            `Currently dont support instrumenting tuple assignments in for init/loop expession`
        );
        container.vBody = factory.makeBlock([e.parent]);
        return;
    }

    if (container instanceof WhileStatement) {
        assert(
            container.vBody === e.parent,
            `Currently dont support instrumenting tuple assignments in for init/loop expession`
        );
        container.vBody = factory.makeBlock([e.parent]);
        return;
    }

    if (container instanceof DoWhileStatement) {
        assert(
            container.vBody === e.parent,
            `Currently dont support instrumenting tuple assignments in for init/loop expession`
        );
        container.vBody = factory.makeBlock([e.parent]);
        return;
    }
}

/**
 * Complex interposing case - when `updateNode` is a (potentially nested) tuple assignment with multiple
 * state vars and other expressions updated toghether.
 *
 * @param ctx
 * @param updateNode
 * @param stateVars - state variables whose update we want to interpose on.
 */
export function interposeTupleAssignment(
    transCtx: TranspilingContext,
    updateNode: Assignment,
    stateVars: Set<VariableDeclaration>
): Map<string, FunctionDefinition> {
    const ctx = transCtx.instrCtx;
    const factory = ctx.factory;
    const containingFun = updateNode.getClosestParentByType(
        FunctionDefinition
    ) as FunctionDefinition;
    const res = new Map<string, FunctionDefinition>();

    // First make sure we can instrument this node
    ensureToplevelExprInBlock(updateNode, factory);

    // Helper function for creating temporary LHSs. Can be either
    // fields of a temporary struct var, or temporary local vars.
    const makeTempHelper = (
        oldExp: Expression,
        typ: TypeName,
        loc: DataLocation
    ): MemberAccess | Identifier => {
        const name = transCtx.getTupleAssignmentBinding(oldExp);
        if (loc !== DataLocation.Storage || !isTypeAliasable(typ)) {
            transCtx.addBinding(name, typ);
            return transCtx.refBinding(name);
        } else {
            const body = containingFun.vBody as Block;
            const decl = factory.makeVariableDeclaration(
                false,
                false,
                name,
                containingFun.id,
                false,
                loc,
                StateVariableVisibility.Default,
                Mutability.Mutable,
                makeTypeString(typ, DataLocation.Storage),
                undefined,
                typ
            );
            body.insertBefore(
                factory.makeVariableDeclarationStatement([], [decl]),
                body.vStatements[0]
            );

            ctx.addGeneralInstrumentation(decl);

            return factory.makeIdentifierFor(decl);
        }
    };

    const keyReplMap: Array<[Expression, Identifier | MemberAccess]> = [];
    const lhsReplMap: Array<[Expression, Identifier | MemberAccess]> = [];

    const freshLHSToPathM = new Map<number, number[]>();

    const mapTmpSrc = (tmp: Identifier | MemberAccess, original: Expression): void => {
        tmp.src = original.src;
        if (tmp instanceof MemberAccess) {
            ctx.addGeneralInstrumentation(tmp.vExpression);
        }
    };

    const replaceLHSComp = (lhsComp: Expression, rhsT: SType, tuplePath: number[]): void => {
        const solTempT = generateTypeAst(rhsT, factory);
        const loc = getTypeLocation(rhsT);

        const [base, path] = decomposeLHS(lhsComp);
        const varDecl = base.vReferencedDeclaration as VariableDeclaration;
        const freshLHS = makeTempHelper(lhsComp, solTempT, loc);
        replaceNode(lhsComp, freshLHS);
        lhsReplMap.push([lhsComp, freshLHS]);
        freshLHSToPathM.set(freshLHS.id, tuplePath);
        mapTmpSrc(freshLHS, lhsComp);

        for (const el of getKeysAndCompTypes(factory, varDecl, path)[0]) {
            if (typeof el === "string") {
                continue;
            }

            const [typ, idxExp] = el;

            const freshKey = makeTempHelper(idxExp, typ, DataLocation.Memory);
            replaceNode(idxExp, freshKey);
            keyReplMap.push([idxExp, freshKey]);
            mapTmpSrc(freshKey, idxExp);
        }
    };

    const skipSingletons = (e: Expression): Expression => {
        while (e instanceof TupleExpression && e.vOriginalComponents.length === 1) {
            const innerT = e.vOriginalComponents[0];
            assert(innerT !== null, ``);
            e = innerT;
        }

        return e;
    };

    // Walk over LHS tuple and replace each expression with a temporary Identifier/MemberAccess
    const replaceLHS = (lhs: Expression, rhs: Expression, tuplePath: number[]): void => {
        // Skip singleton tuples
        lhs = skipSingletons(lhs);
        rhs = skipSingletons(rhs);

        if (lhs instanceof TupleExpression) {
            if (rhs instanceof TupleExpression) {
                assert(rhs.vOriginalComponents.length == lhs.vOriginalComponents.length, ``);
                for (let i = lhs.vOriginalComponents.length - 1; i >= 0; i--) {
                    const lhsComp = lhs.vOriginalComponents[i];

                    if (lhsComp === null) {
                        continue;
                    }

                    const rhsComp = rhs.vOriginalComponents[i];
                    assert(rhsComp !== null, ``);
                    replaceLHS(lhsComp, rhsComp, tuplePath.concat(i));
                }
            } else {
                assert(rhs instanceof FunctionCall, ``);
                const lhsT = getExprSType(lhs);
                const rhsT = getExprSType(rhs, lhsT);

                assert(
                    rhsT instanceof STupleType &&
                        rhsT.elements.length === lhs.vOriginalComponents.length,
                    `Type mismatch between lhs tuple ${pp(lhs)} with ${
                        lhs.vOriginalComponents.length
                    } elements and rhs ${pp(rhs)}`
                );

                for (let i = lhs.vOriginalComponents.length - 1; i >= 0; i--) {
                    const lhsComp = lhs.vOriginalComponents[i];
                    const rhsCompT = rhsT.elements[i];

                    if (lhsComp === null) {
                        continue;
                    }

                    assert(
                        !(lhsComp instanceof TupleExpression),
                        `Functions can't return nested tuples`
                    );

                    replaceLHSComp(lhsComp, rhsCompT, tuplePath.concat(i));
                }
            }
        } else {
            const lhsT = getExprSType(lhs);
            const rhsT = getExprSType(rhs, lhsT);

            assert(
                !(rhsT instanceof STupleType),
                `Unexpected rhs type ${rhsT.pp()}(${rhs.typeString}) in assignment.`
            );
            replaceLHSComp(lhs, rhsT, tuplePath);
        }
    };

    assert(updateNode.vLeftHandSide instanceof TupleExpression, ``);
    replaceLHS(updateNode.vLeftHandSide, updateNode.vRightHandSide, []);

    const containingStmt = updateNode.parent as ExpressionStatement;
    const containingBlock = containingStmt.parent as Block;
    // First store the key expressions in temporaries before the tuple assignment
    for (const [originalKey, temporary] of keyReplMap) {
        const lhs = factory.copy(temporary);
        const temporaryUpdate: Expression = factory.makeAssignment(
            "<missing>",
            "=",
            lhs,
            originalKey
        );

        const temporaryUpdateStmt = factory.makeExpressionStatement(temporaryUpdate);
        containingBlock.insertBefore(temporaryUpdateStmt, containingStmt);
        ctx.addGeneralInstrumentation(temporaryUpdateStmt);
    }

    let marker: Statement = containingStmt;
    // Insert an assginment/update function call for each pair of original LHS
    // expression, and temporary expression used to substitute it after the tuple assignment.
    for (const [originalLHS, temporary] of lhsReplMap) {
        const rhs = factory.copy(temporary);
        const temporaryUpdate: Expression = factory.makeAssignment(
            "<missing>",
            "=",
            originalLHS,
            rhs
        );

        const temporaryUpdateStmt = factory.makeExpressionStatement(temporaryUpdate);
        containingBlock.insertAfter(temporaryUpdateStmt, marker);
        marker = temporaryUpdateStmt;
        ctx.addGeneralInstrumentation(temporaryUpdateStmt);

        // If this is a state var update re-write it to a wrapped call
        const [base] = decomposeLHS(originalLHS);
        const stateVar = isStateVarRef(base)
            ? (base.vReferencedDeclaration as VariableDeclaration)
            : undefined;

        // @todo enhance this to account for paths of interest
        if (stateVar !== undefined && stateVars.has(stateVar)) {
            const [, wrapper] = interposeSimpleStateVarUpdate(ctx, temporaryUpdate as Assignment);
            const tuplePath = freshLHSToPathM.get(temporary.id);
            assert(tuplePath !== undefined, ``);

            const updateNodeKey = stateVarUpdateNode2Str([updateNode, tuplePath]);
            res.set(updateNodeKey, wrapper);
        }
    }

    return res;
}

export function interposeInlineInitializer(
    ctx: InstrumentationContext,
    updateNode: VariableDeclaration
): [FunctionCall, FunctionDefinition] {
    const factory = ctx.factory;
    const containingContract = updateNode.vScope;
    assert(containingContract instanceof ContractDefinition, ``);

    const wrapperName = getWrapperName(updateNode, updateNode, [], []);

    assert(
        ctx.getWrapper(containingContract, wrapperName) === undefined,
        `inline wrappers should be defined only once`
    );

    const wrapperFun = factory.makeFunctionDefinition(
        containingContract.id,
        FunctionKind.Function,
        wrapperName,
        false,
        FunctionVisibility.Internal,
        FunctionStateMutability.NonPayable,
        false,
        factory.makeParameterList([]),
        factory.makeParameterList([]),
        [],
        undefined,
        factory.makeBlock([]),
        ``
    );

    containingContract.appendChild(wrapperFun);
    ctx.setWrapper(containingContract, wrapperName, wrapperFun);

    const actualParams: Expression[] = [];

    const wrapperCall = factory.makeFunctionCall(
        "<missing>",
        FunctionCallKind.FunctionCall,
        factory.makeIdentifierFor(wrapperFun),
        actualParams
    );
    const wrapperCallStmt = factory.makeExpressionStatement(wrapperCall);

    ctx.addGeneralInstrumentation(wrapperCallStmt);

    const constr = getOrAddConstructor(containingContract, factory);
    assert(
        constr.vBody !== undefined,
        `We don't support instrumenting the state var ${containingContract.name}.${updateNode.name} with iniline-initializer in a contract with an abstract constructor.`
    );

    if (constr.vBody.vStatements.length > 0) {
        (constr.vBody as Block).insertBefore(wrapperCallStmt, constr.vBody.vStatements[0]);
    } else {
        (constr.vBody as Block).appendChild(wrapperCallStmt);
    }

    return [wrapperCall, wrapperFun];
}

/**
 * "Simple" interposing case - when `updateNode` updates only a single state var. Corresponds to:
 *
 * 1. Simple assignments (LHS is not a tuple) (updateNode instanceof Assignment)
 * 2. Array push/pop (udpateNode instanceof FunctionCall)
 * 3. Stateful unary ops - delete, ++, -- (updateNode instanceof UnaryOperation )
 * @param ctx
 * @param updateNode
 */
export function interposeSimpleStateVarUpdate(
    ctx: InstrumentationContext,
    updateNode: Assignment | FunctionCall | UnaryOperation
): [FunctionCall, FunctionDefinition] {
    const factory = ctx.factory;
    const [stateVarExp, additionalArgs] = decomposeStateVarUpdated(updateNode, factory);
    const [baseExp, path] = decomposeLHS(stateVarExp);
    assert(isStateVarRef(baseExp), ``);

    const wrapperFun = makeWrapper(ctx, updateNode);

    const actualParams: Expression[] = [];

    actualParams.push(...(path.filter((el) => el instanceof Expression) as Expression[]));
    actualParams.push(...additionalArgs.map((v) => v[0]));

    const wrapperCall = factory.makeFunctionCall(
        "<missing>",
        FunctionCallKind.FunctionCall,
        factory.makeIdentifierFor(wrapperFun),
        actualParams
    );

    ctx.addGeneralInstrumentation(wrapperCall);
    if (updateNode.parent instanceof ExpressionStatement) {
        updateNode.parent.src = "0:0:0";
    }
    replaceNode(updateNode, wrapperCall);
    wrapperCall.src = updateNode.src;

    return [wrapperCall, wrapperFun];
}

/**
 * Checks whether the given `StateVarUpdateLoc` `loc` matches the given annotation `annot`.
 * @param loc
 * @param annot
 */
function updateLocMatchesAnnotation(loc: StateVarUpdateLoc, annot: AnnotationMetaData): boolean {
    if (!(annot instanceof PropertyMetaData && annot.parsedAnnot instanceof SStateVarProp)) {
        return false;
    }

    const [, stateVar, concretePath] = loc;

    if (annot.target !== stateVar) {
        return false;
    }

    // Currently if_updated cannot have a path
    if (annot.parsedAnnot instanceof SIfUpdated) {
        assert(annot.parsedAnnot.datastructurePath.length === 0, ``);
        return true;
    }

    // This is an if_assigned annotation. Check that the concrete update path
    // matches the formal update path specified in the annotation EXACTLY.
    // @todo may need to change this logic in the future if we change the semantics of if_assigned
    const formalPath = annot.parsedAnnot.datastructurePath;

    if (formalPath.length !== concretePath.length) {
        return false;
    }

    for (let i = 0; i < formalPath.length; i++) {
        const concreteEl = concretePath[i];
        const formalEl = formalPath[i];

        if (formalEl instanceof SId) {
            assert(concreteEl instanceof Expression, ``);
            continue;
        }

        assert(typeof concreteEl === "string", ``);

        if (concreteEl !== formalEl) {
            return false;
        }
    }

    return true;
}

/**
 * Helper to convert `StateVarUpdateNode` to string keys to be used in maps.
 * @param node
 */
function stateVarUpdateNode2Str(node: StateVarUpdateNode): string {
    const astNode = node instanceof Array ? node[0] : node;
    let res = `${astNode.id}`;

    if (node instanceof Array) {
        res += node[1].join("_");
    }

    return res;
}

export function instrumentStateVars(
    ctx: InstrumentationContext,
    allAnnotations: AnnotationMap,
    aliasedStateVars: Set<VariableDeclaration>,
    stateVarUpdates: StateVarUpdateLoc[]
): void {
    // First check if any of the annotated vars is aliased - if so throw an error
    for (const [varDef, annots] of allAnnotations.entries()) {
        if (!(varDef instanceof VariableDeclaration && annots.length > 0)) {
            continue;
        }

        if (aliasedStateVars.has(varDef)) {
            throw new Error(
                `Cannot instrument state var ${(varDef.parent as ContractDefinition).name}.${
                    varDef.name
                } as it may be aliased by a storage pointer`
            );
        }
    }

    // A single instrumented location can contain multiple variables to
    // instrument due to tuple assignments. This is an inverse map from ASTNodes
    // to a list of `StateVarUpdateLoc` Each entry in that list describes a
    // concrete state var update inside this ASTNode, for which there are
    // annotations.
    const locInstrumentMap = new Map<
        VariableDeclaration | Assignment | FunctionCall | UnaryOperation,
        StateVarUpdateLoc[]
    >();

    // This map keeps track of all annotations that match a given `StateVarUpdateNode` location,
    // where the location is encode as string by stateVarUpdateNode2Str
    const annotMap = new Map<string, AnnotationMetaData[]>();

    // Compute `locInstrumentMap` and `annotMap`
    for (const stateVarUpdate of stateVarUpdates) {
        const [loc, varDecl, path, newVal] = stateVarUpdate;

        const allVarAnnots = allAnnotations.get(varDecl);
        if (allVarAnnots === undefined || allVarAnnots.length === 0) {
            continue;
        }

        const matchingVarAnnots = allVarAnnots.filter((annot) =>
            updateLocMatchesAnnotation(stateVarUpdate, annot)
        );

        if (matchingVarAnnots.length === 0) {
            continue;
        }

        const node = loc instanceof Array ? loc[0] : loc;
        const locList = getOrInit(node, locInstrumentMap, []);

        locList.push([loc, varDecl, path, newVal]);
        annotMap.set(stateVarUpdateNode2Str(loc), matchingVarAnnots);
    }

    // This is a map from `StateVarUpdateNodes` that were updated to the wrapper function generated for each node
    const wrapperMap = new Map<string, FunctionDefinition>();

    // Next use `locInstrumentMap` to interpose on all the state var update locations.
    // Populte the `wrapperMap` as we go with the wrappers that were generated.
    for (const [node, locs] of locInstrumentMap.entries()) {
        const containingFun = node.getClosestParentByType(FunctionDefinition) as FunctionDefinition;

        if (node instanceof VariableDeclaration) {
            assert(locs.length === 1, ``);
            const [, wrapper] = interposeInlineInitializer(ctx, node);
            wrapperMap.set(stateVarUpdateNode2Str(node), wrapper);
            continue;
        }

        if (node instanceof Assignment && node.vLeftHandSide instanceof TupleExpression) {
            const varsOfInterest = new Set(locs.map((loc) => loc[1]));
            const transCtx = ctx.getTranspilingCtx(containingFun);
            const tupleWrappedMap = interposeTupleAssignment(transCtx, node, varsOfInterest);

            updateMap(wrapperMap, tupleWrappedMap);
        } else {
            assert(locs.length === 1, `Expected single updated var loc, not ${pp(locs)}`);
            const [, wrapper] = interposeSimpleStateVarUpdate(ctx, node);
            wrapperMap.set(stateVarUpdateNode2Str(locs[0][0]), wrapper);
        }
    }

    const seen = new Set<FunctionDefinition>();

    // Finally use `wrapperMap` and `annotMap` to add instrumentation to each of the wrappers.
    // Note that the same wrapper may appear multiple times in `wrapperMap` so we use the `seen` set
    // to not double-instrument.
    // @todo the logic is inefficient here - we should be able to iterate just over the wrappers.
    for (const [updateLocKey, wrapper] of wrapperMap.entries()) {
        if (seen.has(wrapper)) {
            continue;
        }

        seen.add(wrapper);
        const relevantAnnotats = annotMap.get(updateLocKey) as PropertyMetaData[];
        assert(relevantAnnotats !== undefined, ``);

        // @todo need a map from [varDecl, path] => arg
        const transCtx = ctx.getTranspilingCtx(wrapper);
        const body = wrapper.vBody as Block;

        const instrResult = generateExpressions(relevantAnnotats, transCtx);
        const contract = wrapper.vScope as ContractDefinition;
        const recipe = insertInvChecks(transCtx, instrResult, relevantAnnotats, contract, body);
        cook(recipe);
    }

    // Finally strip the documentation, otherwise solidity may fail due to about natspec on internal vars
    for (const [target, annots] of allAnnotations.entries()) {
        if (!(target instanceof VariableDeclaration && annots.length > 0)) {
            continue;
        }

        target.documentation = undefined;
    }
}
