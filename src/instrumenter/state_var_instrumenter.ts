import { lt } from "semver";
import {
    AddressType,
    ArrayType,
    ArrayTypeName,
    Assignment,
    ASTNode,
    ASTNodeFactory,
    Block,
    BoolType,
    BytesType,
    ContractDefinition,
    ContractKind,
    DataLocation,
    DoWhileStatement,
    Expression,
    ExpressionStatement,
    ExternalReferenceType,
    FixedBytesType,
    ForStatement,
    FunctionCall,
    FunctionCallKind,
    FunctionDefinition,
    FunctionKind,
    FunctionStateMutability,
    FunctionVisibility,
    generalizeType,
    getNodeTypeInCtx,
    Identifier,
    IfStatement,
    IntLiteralType,
    IntType,
    Mapping,
    MappingType,
    MemberAccess,
    Mutability,
    PointerType,
    replaceNode,
    specializeType,
    Statement,
    StatementWithChildren,
    StateVariableVisibility,
    StringLiteralType,
    StringType,
    StructDefinition,
    TupleExpression,
    TupleType,
    TypeName,
    typeNameToTypeNode,
    TypeNode,
    UnaryOperation,
    UncheckedBlock,
    UserDefinedType,
    UserDefinedTypeName,
    VariableDeclaration,
    WhileStatement
} from "solc-typed-ast";
import { AnnotationMetaData } from ".";
import {
    AnnotationMap,
    ConcreteDatastructurePath,
    decomposeLHS,
    getOrInit,
    getTypeLocation,
    insertAnnotations,
    isStateVarRef,
    isTypeAliasable,
    last,
    pp,
    PropertyMetaData,
    single,
    StateVarUpdateDesc,
    StateVarUpdateNode,
    transpileType,
    UnsupportedConstruct,
    updateMap
} from "..";
import { SId, SIfUpdated, SStateVarProp } from "../spec-lang/ast";
import { assert } from "../util";
import { InstrumentationContext } from "./instrumentation_context";
import { InstrumentationSiteType, TranspilingContext } from "./transpiling_context";
import { makeTypeString } from "./type_string";

/**
 * Given a Solidity `Expression` `e` and the `expectedType` where its being used,
 * compute the actual `SType` of `e`. This may be different from `expectedType` due to implicit
 * casts.
 */
function getMaterialExprType(
    e: Expression,
    version: string,
    ctx: ASTNode,
    expectedType?: TypeNode
): TypeNode {
    /**
     * Sanitize the parsed `actualType` by replacing any int_const types with the
     * concrete integer type expected at that location, and any string literal types with
     * `string memory`. Note this code makes the assumption that int literals and string literal
     * types CANNOT show up inside array/mapping types (which I think is true?).
     */
    const sanitizeType = (actualType: TypeNode, expectedType: TypeNode): TypeNode => {
        if (actualType instanceof IntLiteralType) {
            assert(
                expectedType instanceof IntType,
                `Expected ${expectedType.pp()} got ${actualType.pp()}`
            );
            return expectedType;
        }

        if (actualType instanceof StringLiteralType) {
            return new PointerType(new StringType(), DataLocation.Memory);
        }

        if (actualType instanceof TupleType) {
            assert(
                expectedType instanceof TupleType &&
                    expectedType.elements.length === actualType.elements.length,
                `Expected ${expectedType.pp()} got ${actualType.pp()}`
            );

            return new TupleType(
                actualType.elements.map((el, i) => sanitizeType(el, expectedType.elements[i]))
            );
        }

        return actualType;
    };

    const parsedType: TypeNode = getNodeTypeInCtx(e, version, ctx);

    return expectedType !== undefined ? sanitizeType(parsedType, expectedType) : parsedType;
}

export type ConcreteDatastructurePathWTypes = Array<[TypeName, Expression] | string>;
/**
 * Given a `ConcreteDatastructurePath` `path`, return:
 * 1) A copy of the concrete `path` with types added for all `IndexAccess` keys in the path.
 * 2) The type of the part of the variable declaration `varDecl` that is pointed to by `path`.
 */
function getKeysAndTheirTypes(
    factory: ASTNodeFactory,
    varDecl: VariableDeclaration,
    path: ConcreteDatastructurePath
): [ConcreteDatastructurePathWTypes, TypeName] {
    let typ = varDecl.vType as TypeName;
    const keyTypes: ConcreteDatastructurePathWTypes = [];

    for (const comp of path) {
        if (comp instanceof Expression) {
            if (typ instanceof ArrayTypeName) {
                keyTypes.push([factory.makeElementaryTypeName("<missing>", "uint256"), comp]);
                typ = typ.vBaseType;
            } else if (typ instanceof Mapping) {
                keyTypes.push([typ.vKeyType, comp]);
                typ = typ.vValueType;
            } else {
                assert(
                    typ instanceof UserDefinedTypeName &&
                        typ.vReferencedDeclaration instanceof StructDefinition &&
                        typ.vReferencedDeclaration.vScope instanceof ContractDefinition &&
                        typ.vReferencedDeclaration.vScope.kind === ContractKind.Library,
                    `Expected a reference to a custom library struct, not ${typ.print()}`
                );

                const lib = typ.vReferencedDeclaration.vScope;
                const getLHSDef = single(lib.vFunctions.filter((fDef) => fDef.name === "get_lhs"));
                keyTypes.push([getLHSDef.vParameters.vParameters[1].vType as TypeName, comp]);
                typ = getLHSDef.vReturnParameters.vParameters[0].vType as TypeName;
            }
        } else {
            if (typ instanceof UserDefinedTypeName) {
                assert(typ.vReferencedDeclaration instanceof StructDefinition, ``);
                typ = single(
                    typ.vReferencedDeclaration.vMembers.filter((member) => member.name === comp)
                ).vType as TypeName;

                keyTypes.push(comp);
            } else {
                assert(typ instanceof ArrayTypeName && comp === "length", ``);
                typ = factory.makeElementaryTypeName("<missing>", "uint256");
            }
        }
    }

    return [keyTypes, typ];
}

function decomposeLHSWithTypes(
    lhs: Expression,
    factory: ASTNodeFactory
): [Identifier | MemberAccess, ConcreteDatastructurePathWTypes, TypeName] {
    const [base, concretePath] = decomposeLHS(lhs);
    assert(base.vReferencedDeclaration instanceof VariableDeclaration, ``);
    const [concretePathWithTypes, exprType] = getKeysAndTheirTypes(
        factory,
        base.vReferencedDeclaration,
        concretePath
    );

    return [base, concretePathWithTypes, exprType];
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
 */
function getTypeDescriptor(typ: TypeNode): string {
    if (typ instanceof AddressType) {
        return `address${typ.payable ? "_payable" : ""}`;
    }

    if (typ instanceof ArrayType) {
        const baseStr = getTypeDescriptor(typ.elementT);
        return `arr_${baseStr}${typ.size ? "_" + typ.size : ""}`;
    }

    if (typ instanceof BoolType) {
        return `bool`;
    }

    if (typ instanceof BytesType) {
        return `bytes`;
    }

    if (typ instanceof FixedBytesType) {
        return `bytes_${typ.size}`;
    }

    if (typ instanceof IntType) {
        return (typ.signed ? "" : "u") + `int${typ.nBits}`;
    }

    if (typ instanceof MappingType) {
        return `mapping_${getTypeDescriptor(typ.keyType)}_${getTypeDescriptor(typ.valueType)}`;
    }

    if (typ instanceof PointerType) {
        return `ptr_${getTypeDescriptor(typ.to)}_${typ.location}`;
    }

    if (typ instanceof StringType) {
        return `string`;
    }

    if (typ instanceof UserDefinedType) {
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
 *    Note that as a result we may get multiple wrappers for the same (var,path) combo due to implicit casts
 *  - the type of the new value being assigned/pushed (if any)
 *  - the kind of update node this is - pop, push, push without arg, assignment, delete, pre/post-fix inc/dec
 */
function getWrapperName(
    updateNode: Assignment | FunctionCall | UnaryOperation | VariableDeclaration,
    varDecl: VariableDeclaration,
    path: Array<string | [TypeName, Expression]>,
    additionalArgs: Array<[Expression, TypeName]>,
    version: string
): string {
    const defContract = varDecl.vScope as ContractDefinition;
    const pathString = path
        .map((el) => {
            if (typeof el === "string") {
                return el;
            }
            const [expectedTyp, expr] = el;

            const exprT = getMaterialExprType(
                expr,
                version,
                updateNode,
                typeNameToTypeNode(expectedTyp)
            );
            return `idx_${getTypeDescriptor(exprT)}`;
        })
        .join("_");

    const additionalArgsString = additionalArgs
        .map(([expr, typ]) =>
            getTypeDescriptor(
                getMaterialExprType(expr, version, updateNode, typeNameToTypeNode(typ))
            )
        )
        .join("_");

    let suffix: string;

    if (updateNode instanceof Assignment) {
        suffix = assignSuffixMap[updateNode.operator];
    } else if (updateNode instanceof FunctionCall) {
        suffix = updateNode.vFunctionName;
        if (suffix === "push" && updateNode.vArguments.length === 0) {
            suffix += "_noarg";
        }
    } else if (updateNode instanceof VariableDeclaration) {
        suffix = "inline_initializer";
    } else if (updateNode.operator === "delete") {
        suffix = "delete";
    } else {
        suffix = updateNode.operator === "++" ? "inc" : "dec";
        suffix += updateNode.prefix ? "_prefix" : "_postfix";
    }

    if (updateNode.getClosestParentByType(UncheckedBlock) !== undefined) {
        suffix += "_unchecked";
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
 */
function decomposeStateVarUpdated(
    updateNode: Assignment | FunctionCall | UnaryOperation,
    ctx: InstrumentationContext
): [Expression, Array<[Expression, TypeName]>] {
    let stateVarExp: Expression;
    const additionalArgs: Array<[Expression, TypeName]> = [];
    const factory = ctx.factory;

    if (updateNode instanceof FunctionCall) {
        const callee = updateNode.vFunctionName;
        if (
            updateNode.vFunctionCallType === ExternalReferenceType.Builtin &&
            (callee === "push" || callee === "pop")
        ) {
            stateVarExp = (updateNode.vExpression as MemberAccess).vExpression;

            if (callee == "push" && updateNode.vArguments.length > 0) {
                const [baseExp, , compT] = decomposeLHSWithTypes(stateVarExp, factory);
                assert(
                    isStateVarRef(baseExp),
                    `Expected base to be a state var ref not ${pp(baseExp)}`
                );
                assert(
                    compT instanceof ArrayTypeName,
                    `Expected base to be of array type not ${pp(compT)}`
                );
                additionalArgs.push([single(updateNode.vArguments), compT.vBaseType]);
            }
        } else {
            assert(
                updateNode.vFunctionName === "set" &&
                    updateNode.vReferencedDeclaration instanceof FunctionDefinition &&
                    updateNode.vReferencedDeclaration.vScope instanceof ContractDefinition &&
                    updateNode.vReferencedDeclaration?.vScope.kind === ContractKind.Library,
                `decomposeStateVarUpdated(): Unexpected update node ${pp(updateNode)} in`
            );

            const [keyT, valueT] = ctx.typesToLibraryMap.getKVTypes(
                updateNode.vReferencedDeclaration.vScope
            );

            stateVarExp = updateNode.vArguments[0];
            // Adding the last part of the path as an additional argument here
            // to avoid modifying decomposeLHS
            additionalArgs.push([updateNode.vArguments[1], transpileType(keyT, factory)]);
            additionalArgs.push([updateNode.vArguments[2], transpileType(valueT, factory)]);
        }
    } else if (updateNode instanceof UnaryOperation) {
        stateVarExp = updateNode.vSubExpression;
    } else {
        assert(!(updateNode.vLeftHandSide instanceof TupleExpression), `Tuples handled elsewhere`);
        stateVarExp = updateNode.vLeftHandSide;
        const [baseExp, , compT] = decomposeLHSWithTypes(stateVarExp, factory);
        assert(isStateVarRef(baseExp), ``);
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
 */
function makeWrapper(
    ctx: InstrumentationContext,
    updateNode: Assignment | FunctionCall | UnaryOperation
): FunctionDefinition {
    const factory = ctx.factory;
    // Work on a copy of updateNode, as we will modify it destructively
    // and put it inside the body of the wrapper
    const rewrittenNode = factory.copy(updateNode);

    // Decomposing is a 2 step process.
    // 1) Call decomposeStateVarUpdated to decompose the various update statements - assignments, function calls, unaries..
    const [stateVarExp, additionalArgs] = decomposeStateVarUpdated(rewrittenNode, ctx);
    // 2) Call decomposeLHS to identify the actuall state variable, and the path of the part of it which is updated
    const [baseExp, path] = decomposeLHSWithTypes(stateVarExp, factory);
    assert(isStateVarRef(baseExp), ``);

    const varDecl = baseExp.vReferencedDeclaration as VariableDeclaration;
    const definingContract = varDecl.vScope as ContractDefinition;
    const funName = getWrapperName(updateNode, varDecl, path, additionalArgs, ctx.compilerVersion);

    // Check if we have already built a wrapper for this variable/path/update type. Otherwise build one now.
    const cached = ctx.wrapperCache.get(definingContract, funName);
    if (cached !== undefined) {
        return cached;
    }

    // List of the types of parameters for the wrapper
    const formalParamTs: TypeNode[] = [];
    // Map from ids of expressions inside `rewrittenNode` to the index of the parameter with which
    // we will replace them.
    const replMap = new Map<number, number>();

    for (const pathEl of path) {
        if (typeof pathEl === "string") {
            continue;
        }

        const [keyT, keyExp] = pathEl;
        replMap.set(keyExp.id, formalParamTs.length);
        const exprT = getMaterialExprType(
            keyExp,
            ctx.compilerVersion,
            updateNode,
            typeNameToTypeNode(keyT)
        );
        formalParamTs.push(exprT);
    }

    for (const [actual, formalT] of additionalArgs) {
        replMap.set(actual.id, formalParamTs.length);
        const exprT = getMaterialExprType(
            actual,
            ctx.compilerVersion,
            updateNode,
            typeNameToTypeNode(formalT)
        );
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
        factory.makeBlock([])
    );

    definingContract.appendChild(wrapperFun);
    ctx.wrapperCache.set(wrapperFun, definingContract, funName);
    const body = wrapperFun.vBody as Block;
    ctx.addGeneralInstrumentation(body);

    // Add parameters to the wrapper
    for (let i = 0; i < formalParamTs.length; i++) {
        const formalT = formalParamTs[i];

        factory.addFunArg(
            ctx.nameGenerator.getFresh(`ARG`),
            formalT,
            getTypeLocation(formalT),
            wrapperFun
        );
    }

    // Replace expressions in the `rewrittenNode` with their corresponding parameters according to `replMap`
    for (const [nodeId, argIdx] of replMap.entries()) {
        const node = rewrittenNode.requiredContext.locate(nodeId);
        replaceNode(node, factory.makeIdentifierFor(wrapperFun.vParameters.vParameters[argIdx]));
    }

    // Add the re-written update node in the body of the wrapper
    let rewrittenNodeStmt: Statement = factory.makeExpressionStatement(rewrittenNode);

    // If the original node was in an unchecked block, wrap the re-written node in unchecked too.
    if (updateNode.getClosestParentByType(UncheckedBlock) !== undefined) {
        rewrittenNodeStmt = factory.makeUncheckedBlock([rewrittenNodeStmt]);
    }

    factory.addStmt(wrapperFun, rewrittenNodeStmt);

    ctx.addGeneralInstrumentation(rewrittenNodeStmt);

    // Compute what the wrapper must return depending on the type of `rewrittenNode
    const retParamTs: TypeNode[] = [];

    // Add any return parameters if needed
    if (rewrittenNode instanceof UnaryOperation) {
        if (["++", "--"].includes(rewrittenNode.operator)) {
            const retT = getMaterialExprType(rewrittenNode, ctx.compilerVersion, updateNode);
            assert(retT instanceof IntType, ``);
            retParamTs.push(retT);
        }
    } else if (rewrittenNode instanceof Assignment) {
        const retT = getMaterialExprType(
            rewrittenNode.vLeftHandSide,
            ctx.compilerVersion,
            updateNode
        );
        assert(
            !(retT instanceof TupleType),
            `makeWrapper should only be invoked on primitive assignments.`
        );
        retParamTs.push(retT);
    } // Remaining update node types don't return

    // Add the returns to the wrapper FunctionDefinition
    for (const formalT of retParamTs) {
        factory.addFunRet(
            ctx,
            ctx.nameGenerator.getFresh("RET"),
            formalT,
            getTypeLocation(formalT),
            wrapperFun
        );
    }

    // Add the actual return statements (assignments) if we have return parameters
    if (retParamTs.length > 0) {
        assert(
            rewrittenNode instanceof Assignment ||
                (rewrittenNode instanceof UnaryOperation &&
                    ["++", "--"].includes(rewrittenNode.operator)),
            `Only assignments and ++/-- return values. Not: ${pp(rewrittenNode)}`
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

        if (
            rewrittenNode instanceof Assignment ||
            (rewrittenNode instanceof UnaryOperation && rewrittenNode.prefix)
        ) {
            body.appendChild(retStmt);
        } else {
            body.insertAtBeginning(retStmt);
        }
    }

    return wrapperFun;
}

/**
 * Given a statement `e`, if `e` is not contained inside of a `Block` (or `UncheckedBlock`) insert a `Block` between it and its parent.
 */
export function ensureStmtInBlock(
    e: Statement | StatementWithChildren<any>,
    factory: ASTNodeFactory
): void {
    const container = e.parent;

    assert(container !== undefined, `Unexpected statement ${e.print()} with no parent`);

    if (container instanceof Block || container instanceof UncheckedBlock) {
        return;
    }

    if (container instanceof IfStatement) {
        if (container.vTrueBody === e) {
            container.vTrueBody = factory.makeBlock([e]);
        } else {
            assert(
                container.vFalseBody === e,
                `Unexpected child ${e.print()} of ${container.print()}`
            );
            container.vFalseBody = factory.makeBlock([e]);
        }

        container.acceptChildren();
        return;
    }

    if (container instanceof ForStatement) {
        if (e === container.vBody) {
            container.vBody = factory.makeBlock([e]);
        } else if (e === container.vInitializationExpression) {
            /**
             * Convert `for(initStmt; ...)` into `initStmt; for(; ...)`
             */
            ensureStmtInBlock(container, factory);
            const grandad = container.parent as Block;

            grandad.insertBefore(e, container);
            container.vInitializationExpression = undefined;
            grandad.acceptChildren();
        } else {
            /**
             * Convert `for(...;loopStmt) e` into `for(...;) { e; loopStmt; }`
             */
            assert(
                e === container.vLoopExpression,
                `unexpected child ${e.print()} of ${container.print()}`
            );

            if (!(container.vBody instanceof StatementWithChildren)) {
                ensureStmtInBlock(container.vBody, factory);
            }

            const body = container.vBody as Block;
            body.appendChild(container.vLoopExpression);

            container.vLoopExpression = undefined;
            body.acceptChildren();
        }

        container.acceptChildren();
        return;
    }

    if (container instanceof WhileStatement || container instanceof DoWhileStatement) {
        container.vBody = factory.makeBlock([e]);
        container.acceptChildren();
        return;
    }

    assert(false, `NYI container type ${container.constructor.name}`);
}

/**
 * Given the expression `e` make sure that `e` is contained in an `ExpressionStatement`, which itself
 * is contained in a `Block`. There are several cases where we may need to create the block itself
 */
export function ensureTopLevelExprInBlock(e: Expression, factory: ASTNodeFactory): void {
    assert(e.parent instanceof ExpressionStatement, ``);
    ensureStmtInBlock(e.parent, factory);
}

/**
 * Given a complex (potentially nested) tuple assignment with explode it into a list of simple non-tuple assignments.
 *
 * The strategy here is to replace all expressions inside tuples on the LHS of `updateNode` with temporaries, then assign
 * those temporaries one-by-one to the original LHS expressions (while interposing with wrappers wherever we have properties to check).
 *
 * Special care needs to be taken for any indexing sub-expressions appearing inside the LHS expressions - those need to be computed before
 * the assignment to preserve evaluation order.
 *
 * @param stateVars - state variables whose update we want to interpose on.
 */
export function explodeTupleAssignment(
    transCtx: TranspilingContext,
    updateNode: Assignment
): Array<[Assignment, number[]]> {
    const ctx = transCtx.instrCtx;
    const factory = ctx.factory;
    const containingFun = updateNode.getClosestParentByType(
        FunctionDefinition
    ) as FunctionDefinition;

    // First make sure we can instrument this node
    ensureTopLevelExprInBlock(updateNode, factory);

    // Helper function for creating temporary LHSs. Can be either
    // fields of a temporary struct var, or temporary local vars.
    const makeTempHelper = (
        oldExp: Expression,
        typ: TypeName,
        loc: DataLocation
    ): MemberAccess | Identifier => {
        const name = transCtx.getTupleAssignmentBinding(oldExp);

        // If the expression is not a storage pointer can add it to the temporaries struct
        if (loc !== DataLocation.Storage || !isTypeAliasable(typ)) {
            transCtx.addBinding(name, typ);
            return transCtx.refBinding(name);
        } else {
            // Otherwise need to emit a temporary local variable
            if (lt(ctx.compilerVersion, "0.6.0")) {
                // Prior to 0.6.0 its a compiler error to have a storage pointer
                // variable declaration without an initializer.
                throw new UnsupportedConstruct(
                    `Scribble cannot instrument certain tuple assignments with storage pointers on compilers older than 0.6.0.`,
                    updateNode,
                    ctx.files
                );
            }

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

            const declStmt = factory.makeVariableDeclarationStatement([], [decl]);

            body.insertAtBeginning(declStmt);
            ctx.addGeneralInstrumentation(decl);

            return factory.makeIdentifierFor(decl);
        }
    };

    const keyReplMap: Array<[Expression, Identifier | MemberAccess]> = [];
    const lhsReplMap: Array<[Expression, Identifier | MemberAccess]> = [];

    const freshLHSToPathM = new Map<number, number[]>();

    // Helper to fix the .src information for temporaries back to the original
    const fixTmpSrc = (tmp: Identifier | MemberAccess, original: Expression): void => {
        tmp.src = original.src;
        if (tmp instanceof MemberAccess) {
            ctx.addGeneralInstrumentation(tmp.vExpression);
        }
    };

    // Helper function to replace just ONE part of a tuple with a temporary.
    // The part of the tuple to replace is specified by `tuplePath`
    const replaceLHSComp = (lhsComp: Expression, rhsT: TypeNode, tuplePath: number[]): void => {
        const tempSolT = transpileType(rhsT, factory);
        const loc = getTypeLocation(rhsT);

        const [, path] = decomposeLHSWithTypes(lhsComp, factory);
        const freshLHS = makeTempHelper(lhsComp, tempSolT, loc);
        replaceNode(lhsComp, freshLHS);
        lhsReplMap.push([lhsComp, freshLHS]);
        freshLHSToPathM.set(freshLHS.id, tuplePath);
        fixTmpSrc(freshLHS, lhsComp);

        for (const el of path) {
            if (typeof el === "string") {
                continue;
            }

            const [typ, idxExp] = el;

            const freshKey = makeTempHelper(idxExp, typ, DataLocation.Memory);
            replaceNode(idxExp, freshKey);
            keyReplMap.push([idxExp, freshKey]);
            fixTmpSrc(freshKey, idxExp);
        }
    };

    // Helper function to unwrap any singleton tuples wrapping `e`
    const skipSingletons = (e: Expression): Expression => {
        while (e instanceof TupleExpression && e.vOriginalComponents.length === 1) {
            const innerT = e.vOriginalComponents[0];
            assert(innerT !== null, ``);
            e = innerT;
        }

        return e;
    };

    // Walk over LHS tuple and replace each expression with a temporary Identifier/MemberAccess
    const replaceLHS = (lhs: Expression, tuplePath: number[]): void => {
        // Skip singleton tuples
        lhs = skipSingletons(lhs);

        if (lhs instanceof TupleExpression) {
            // Note traversal in reverse order - turns out tuple assignments happen right-to-left
            for (let i = lhs.vOriginalComponents.length - 1; i >= 0; i--) {
                const lhsComp = lhs.vOriginalComponents[i];

                if (lhsComp === null) {
                    continue;
                }

                replaceLHS(lhsComp, tuplePath.concat(i));
            }
        } else {
            const rawLhsT = getMaterialExprType(lhs, ctx.compilerVersion, updateNode);
            // Note that if the LHS is a storage pointer, we don't want to create temporary pointers to storage,
            // since the RHS may come from memory. So the resulting code wouldn't compile. So we always convert the
            // LHS types to memory (if they are aliasable)
            const lhsT = specializeType(generalizeType(rawLhsT)[0], DataLocation.Memory);

            replaceLHSComp(lhs, lhsT, tuplePath);
        }
    };

    assert(updateNode.vLeftHandSide instanceof TupleExpression, ``);
    replaceLHS(updateNode.vLeftHandSide, []);

    const containingStmt = updateNode.parent as ExpressionStatement;
    const containingBlock = containingStmt.parent as Block | UncheckedBlock;
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
    const res: Array<[Assignment, number[]]> = [];
    // Insert an assginment/update function call for each pair of original LHS
    // expression, and temporary expression used to substitute it after the tuple assignment.
    for (const [originalLHS, temporary] of lhsReplMap) {
        const rhs = factory.copy(temporary);
        const temporaryUpdate = factory.makeAssignment("<missing>", "=", originalLHS, rhs);

        const temporaryUpdateStmt = factory.makeExpressionStatement(temporaryUpdate);
        containingBlock.insertAfter(temporaryUpdateStmt, marker);
        marker = temporaryUpdateStmt;
        ctx.addGeneralInstrumentation(temporaryUpdateStmt);

        res.push([temporaryUpdate, freshLHSToPathM.get(temporary.id) as number[]]);
    }

    return res;
}

/**
 * Complex interposing case - when `updateNode` is a (potentially nested) tuple assignment with multiple
 * state vars and other expressions updated together.
 *
 * The strategy here is to replace all expressions inside tuples on the LHS of `updateNode` with temporaries, then assign
 * those temporaries one-by-one to the original LHS expressions (while interposing with wrappers wherever we have properties to check).
 *
 * Special care needs to be taken for any indexing sub-expressions appearing inside the LHS expressions - those need to be computed before
 * the assignment to preserve evaluation order.
 *
 * @param stateVars - state variables whose update we want to interpose on.
 */
export function interposeTupleAssignment(
    transCtx: TranspilingContext,
    updateNode: Assignment,
    stateVars: Set<VariableDeclaration>
): Map<string, FunctionDefinition> {
    const ctx = transCtx.instrCtx;
    const res = new Map<string, FunctionDefinition>();

    const assignments = explodeTupleAssignment(transCtx, updateNode);
    for (const [temporaryUpdate, tuplePath] of assignments) {
        // If this is a state var update re-write it to a wrapped call
        const originalLHS = temporaryUpdate.vLeftHandSide;
        const [base] = decomposeLHS(originalLHS);
        const stateVar = isStateVarRef(base)
            ? (base.vReferencedDeclaration as VariableDeclaration)
            : undefined;

        // @todo enhance this to account for paths of interest
        if (stateVar !== undefined && stateVars.has(stateVar)) {
            const [, wrapper] = interposeSimpleStateVarUpdate(ctx, temporaryUpdate);
            const updateNodeKey = stateVarUpdateNode2Str([updateNode, tuplePath]);
            res.set(updateNodeKey, wrapper);
        }
    }

    return res;
}

/**
 * Interpose on an state variable inline initializer.
 *
 * Since we can't insert checks during state var initialization, instead we add
 * checks wrapped in their own wrappers called right at the start of the constructor.
 */
export function interposeInlineInitializer(
    ctx: InstrumentationContext,
    updateNode: VariableDeclaration
): [FunctionCall, FunctionDefinition] {
    const factory = ctx.factory;
    const containingContract = updateNode.vScope;
    assert(containingContract instanceof ContractDefinition, ``);

    const wrapperName = getWrapperName(updateNode, updateNode, [], [], ctx.compilerVersion);

    assert(
        !ctx.wrapperCache.has(containingContract, wrapperName),
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
        factory.makeBlock([])
    );

    containingContract.appendChild(wrapperFun);
    ctx.wrapperCache.set(wrapperFun, containingContract, wrapperName);
    ctx.addGeneralInstrumentation(wrapperFun.vBody as Block);

    const actualParams: Expression[] = [];

    const wrapperCall = factory.makeFunctionCall(
        "<missing>",
        FunctionCallKind.FunctionCall,
        factory.makeIdentifierFor(wrapperFun),
        actualParams
    );
    const wrapperCallStmt = factory.makeExpressionStatement(wrapperCall);

    ctx.addGeneralInstrumentation(wrapperCallStmt);

    const constr = factory.getOrAddConstructor(containingContract);

    assert(
        constr.vBody !== undefined,
        `We don't support instrumenting the state var ${containingContract.name}.${updateNode.name} with inline initializer in a contract with an abstract constructor.`
    );

    constr.vBody.insertAtBeginning(wrapperCallStmt);

    return [wrapperCall, wrapperFun];
}

/**
 * "Simple" interposing case - when `updateNode` updates only a single state var. Corresponds to:
 *
 * 1. Simple assignments (LHS is not a tuple) (updateNode instanceof Assignment)
 * 2. Array push/pop (udpateNode instanceof FunctionCall)
 * 3. Stateful unary ops - delete, ++, -- (updateNode instanceof UnaryOperation )
 */
export function interposeSimpleStateVarUpdate(
    ctx: InstrumentationContext,
    updateNode: Assignment | FunctionCall | UnaryOperation
): [FunctionCall, FunctionDefinition] {
    const factory = ctx.factory;
    const [stateVarExp, additionalArgs] = decomposeStateVarUpdated(updateNode, ctx);
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
    replaceNode(updateNode, wrapperCall);
    wrapperCall.src = updateNode.src;

    return [wrapperCall, wrapperFun];
}

/**
 * Checks whether the given `StateVarUpdateLoc` `loc` matches the given annotation `annot`.
 * Some annotations (if_assigned) can specify a part of a complex state var that they apply to.
 *
 * Thus not every update to that state var matches them. For example if we have:
 * ```
 *  struct Point {
 *      uint x;
 *      uint y;
 *  }
 *
 *  //// if_assigned.x p.x > 0;
 *  Point p;
 *  ...
 *      p.y = 2;
 * ```
 *
 * The update to `p.y` doesn't match the `if_assigned` annotation.
 */
function updateLocMatchesAnnotation(loc: StateVarUpdateDesc, annot: AnnotationMetaData): boolean {
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
 */
function stateVarUpdateNode2Str(node: StateVarUpdateNode): string {
    const astNode = node instanceof Array ? node[0] : node;
    let res = `${astNode.id}`;

    if (node instanceof Array) {
        res += node[1].join("_");
    }

    return res;
}

/**
 * Instrument all state variables across all SourceUnits in `ctx` that have state var annotations.
 *
 * @param ctx - instrumentation context
 * @param allAnnotations - map from ASTNodes->AnnotationMetadata containing all parsed annotations
 * @param aliasedStateVars - map containing all state vars that have been aliased. Each aliased state var is mapped to an expression where it may be aliased.
 * @param stateVarUpdates - list of all locations where state variables are updated
 */
export function instrumentStateVars(
    ctx: InstrumentationContext,
    allAnnotations: AnnotationMap,
    stateVarUpdates: StateVarUpdateDesc[]
): void {
    // First select only the state var annotations.
    const stateVarAnnots = new Map<VariableDeclaration, AnnotationMetaData[]>(
        [...allAnnotations.entries()].filter(
            ([n, md]) => n instanceof VariableDeclaration && md.length > 0
        ) as Array<[VariableDeclaration, AnnotationMetaData[]]>
    );

    // First check if any of the annotated vars is aliased - if so throw an error
    for (const varDef of stateVarAnnots.keys()) {
        ctx.crashIfAliased(varDef);
    }

    // A single instrumented location can contain multiple variables to
    // instrument due to tuple assignments. This is an inverse map from ASTNodes
    // to a list of `StateVarUpdateLoc` Each entry in that list describes a
    // concrete state var update inside this ASTNode, for which there are
    // annotations.
    const locInstrumentMap = new Map<
        VariableDeclaration | Assignment | FunctionCall | UnaryOperation,
        StateVarUpdateDesc[]
    >();

    // This map keeps track of all annotations that match a given `StateVarUpdateNode` location,
    // where the location is encode as string by stateVarUpdateNode2Str
    const annotMap = new Map<string, AnnotationMetaData[]>();

    // Compute `locInstrumentMap` and `annotMap`
    for (const stateVarUpdate of stateVarUpdates) {
        const [loc, varDecl, path, newVal] = stateVarUpdate;

        const allVarAnnots = stateVarAnnots.get(varDecl);
        if (allVarAnnots === undefined) {
            continue;
        }

        const matchingVarAnnots = allVarAnnots.filter((annot) =>
            updateLocMatchesAnnotation(stateVarUpdate, annot)
        );

        if (matchingVarAnnots.length === 0) {
            continue;
        }

        const node = loc instanceof Array ? loc[0] : loc;

        if (path.length > 0 && last(path) === "length") {
            throw new UnsupportedConstruct(
                `Cannot instrument state var ${(varDecl.vScope as ContractDefinition).name}.${
                    varDecl.name
                } due to unsupported assignments to .length.`,
                node,
                ctx.files
            );
        }

        if (
            node instanceof FunctionCall &&
            node.vFunctionCallType === ExternalReferenceType.Builtin &&
            node.vFunctionName === "push" &&
            node.vArguments.length === 0
        ) {
            // There is a weird edge case where `.push()` returns a reference that can be updated.
            // E.g.: `arr.push() = 10;`.
            // Is tricky to support this so for now throw if we see it used this way
            assert(
                node.parent instanceof ExpressionStatement,
                `Scribble doesn't support instrumenting assignments to .push().`
            );
        }

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
            const transCtx = ctx.transCtxMap.get(
                containingFun,
                InstrumentationSiteType.StateVarUpdated
            );
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

        const transCtx = ctx.transCtxMap.get(wrapper, InstrumentationSiteType.StateVarUpdated);
        insertAnnotations(relevantAnnotats, transCtx);
    }

    // Finally strip the documentation, otherwise solidity may fail due to natspec on internal vars
    for (const target of stateVarAnnots.keys()) {
        target.documentation = undefined;
    }
}
