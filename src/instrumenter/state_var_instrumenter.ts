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
    generateTypeAst,
    getOrInit,
    getTypeLocation,
    isStateVarRef,
    isTypeAliasable,
    pp,
    single,
    StateVarUpdateLoc
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
    SIntLiteralType,
    SIntType,
    SMappingType,
    SPointer,
    SString,
    STupleType,
    SType,
    SUserDefinedType
} from "../spec-lang/ast";
import { SStringLiteralType } from "../spec-lang/ast/types/string_literal";
import { astTypeNameToSType } from "../spec-lang/tc";
import { makeTypeString } from "./type_string";

function getExprSType(e: Expression, exprSurroundingT?: SType): SType {
    const sType: SType = parseTypeString(e.typeString);

    if (sType instanceof SIntLiteralType) {
        if (exprSurroundingT !== undefined) {
            assert(exprSurroundingT instanceof SIntType, ``);
            return exprSurroundingT;
        }

        return sType;
    } else if (sType instanceof SStringLiteralType) {
        return new SPointer(new SString(), DataLocation.Memory);
    }

    return sType;
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
        // @todo use FQ name here
        return `ud_${typ.name}`;
    }

    throw new Error(`NYI type descriptor for ${typ.pp()}`);
}

function getWrapperName(
    updateNode: Assignment | FunctionCall | UnaryOperation,
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
    body.appendChild(factory.makeExpressionStatement(updateNode));

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

        wrapperFun.vReturnParameters.appendChild(
            factory.makeVariableDeclaration(
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
            )
        );
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
): void /** @todo return what here? */ {
    const ctx = transCtx.instrCtx;
    const factory = ctx.factory;
    const containingFun = updateNode.getClosestParentByType(
        FunctionDefinition
    ) as FunctionDefinition;

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

            return factory.makeIdentifierFor(decl);
        }
    };

    const keyReplMap: Array<[Expression, Identifier | MemberAccess]> = [];
    const lhsReplMap: Array<[Expression, Identifier | MemberAccess]> = [];

    // Walk over LHS tuple and replace each expression with a temporary Identifier/MemberAccess
    const replaceLHS = (lhs: TupleExpression, rhs: Expression): void => {
        // Assignments are evaluated in right-to-left order apparently.
        for (let i = lhs.vOriginalComponents.length - 1; i >= 0; i--) {
            const lhsComp = lhs.vOriginalComponents[i];

            if (lhsComp === null) {
                continue;
            }

            if (lhsComp instanceof TupleExpression) {
                assert(rhs instanceof TupleExpression, `Functions can't return nested tuples`);
                const rhsComp = rhs.vOriginalComponents[i];
                assert(rhsComp !== null, ``);
                replaceLHS(lhsComp, rhsComp);
            } else {
                const rhsT = parseTypeString(rhs.typeString);
                assert(
                    rhsT instanceof STupleType,
                    `Unexpected rhs type ${rhsT.pp()}(${rhs.typeString}) in tuple assignment.`
                );
                const rhsCompT = rhsT.elements[i];
                let tempT: SType;

                if (rhsCompT instanceof SIntLiteralType) {
                    tempT = parseTypeString(lhsComp.typeString);
                    assert(tempT instanceof SIntType, ``);
                } else if (rhsCompT instanceof SStringLiteralType) {
                    tempT = new SPointer(new SString(), DataLocation.Memory);
                } else {
                    tempT = rhsCompT;
                }

                const solTempT = generateTypeAst(tempT, factory);
                const loc = tempT instanceof SPointer ? tempT.location : DataLocation.Default;

                const [base, path] = decomposeLHS(lhsComp);
                const varDecl = base.vReferencedDeclaration as VariableDeclaration;
                const freshLHS = makeTempHelper(lhsComp, solTempT, loc);
                replaceNode(lhsComp, freshLHS);
                lhsReplMap.push([lhsComp, freshLHS]);

                for (const el of getKeysAndCompTypes(factory, varDecl, path)[0]) {
                    if (typeof el === "string") {
                        continue;
                    }

                    const [typ, idxExp] = el;

                    const freshKey = makeTempHelper(idxExp, typ, DataLocation.Memory);
                    replaceNode(idxExp, freshKey);
                    keyReplMap.push([idxExp, freshKey]);
                }
            }
        }
    };

    assert(updateNode.vLeftHandSide instanceof TupleExpression, ``);
    replaceLHS(updateNode.vLeftHandSide, updateNode.vRightHandSide);

    const containingStmt = updateNode.parent as ExpressionStatement;
    const containingBlock = containingStmt.parent as Block;
    // First store the key expressions in temporaries before the tuple assignment
    for (const [originalKey, temporary] of keyReplMap) {
        const temporaryUpdate: Expression = factory.makeAssignment(
            "<missing>",
            "=",
            temporary,
            originalKey
        );

        const temporaryUpdateStmt = factory.makeExpressionStatement(temporaryUpdate);
        containingBlock.insertBefore(temporaryUpdateStmt, containingStmt);
    }

    let marker: Statement = containingStmt;
    // Insert an assginment/update function call for each pair of original LHS
    // expression, and temporary expression used to substitute it after the tuple assignment.
    for (const [originalLHS, temporary] of lhsReplMap) {
        const temporaryUpdate: Expression = factory.makeAssignment(
            "<missing>",
            "=",
            originalLHS,
            temporary
        );

        const temporaryUpdateStmt = factory.makeExpressionStatement(temporaryUpdate);
        containingBlock.insertAfter(temporaryUpdateStmt, marker);
        marker = temporaryUpdateStmt;

        // If this is a state var update re-write it to a wrapped call
        const [base] = decomposeLHS(originalLHS);
        const stateVar = isStateVarRef(base)
            ? (base.vReferencedDeclaration as VariableDeclaration)
            : undefined;

        // @todo enhance this to account for paths of interest
        if (stateVar !== undefined && stateVars.has(stateVar)) {
            interposeSimpleStateVarUpdate(ctx, temporaryUpdate as Assignment);
        }
    }
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

    replaceNode(updateNode, wrapperCall);

    return [wrapperCall, wrapperFun];
}

export function instrumentStateVars(
    ctx: InstrumentationContext,
    annotations: AnnotationMap,
    aliasedStateVars: Set<VariableDeclaration>,
    stateVarUpdates: StateVarUpdateLoc[]
): void {
    for (const varDef of annotations.keys()) {
        if (!(varDef instanceof VariableDeclaration)) {
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

    const stateVarUpdateMap = new Map();
    for (const [node, varDecl, path, newVal] of stateVarUpdates) {
        getOrInit(varDecl, stateVarUpdateMap, []).push([node, path, newVal]);
    }

    // A single instrumented location can contain multiple variables to
    // instrument due to tuple assignments. We pre-comupte the set of
    // locations to update in the below map
    const locInstrumentMap = new Map<
        VariableDeclaration | Assignment | FunctionCall | UnaryOperation,
        StateVarUpdateLoc[]
    >();

    for (const [varDecl, locs] of stateVarUpdateMap.entries()) {
        if (
            !annotations.has(varDecl) ||
            (annotations.get(varDecl) as AnnotationMetaData[]).length > 0
        ) {
            continue;
        }

        for (const [loc, path, newVal] of locs) {
            const node = loc instanceof Array ? loc[0] : loc;
            const locList = getOrInit(node, locInstrumentMap, []);
            locList.push([loc, varDecl, path, newVal]);
        }
    }

    for (const [node, locs] of locInstrumentMap.entries()) {
        if (node instanceof VariableDeclaration) {
            throw new Error(`NYI instrumenting inline initializers`);
        }

        if (node instanceof Assignment && node.vLeftHandSide instanceof TupleExpression) {
            const varsOfInterest = new Set(locs.map((loc) => loc[1]));
            const containingFun = node.getClosestParentByType(
                FunctionDefinition
            ) as FunctionDefinition;
            const transCtx = ctx.getTranspilingCtx(containingFun);
            interposeTupleAssignment(transCtx, node, varsOfInterest);
        } else {
            assert(locs.length === 1, `Expected single updated var loc, not ${pp(locs)}`);
            interposeSimpleStateVarUpdate(ctx, node);
        }
        // @todo return map from [varDecl, path] => arg
        // @todo compile invariants using above map
    }
}
