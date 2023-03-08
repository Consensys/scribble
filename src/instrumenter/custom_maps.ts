import {
    ArrayType,
    ArrayTypeName,
    assert,
    Assignment,
    ASTNode,
    ContractDefinition,
    DataLocation,
    eq,
    Expression,
    ExpressionStatement,
    ExternalReferenceType,
    FunctionCall,
    FunctionCallKind,
    FunctionDefinition,
    FunctionStateMutability,
    FunctionVisibility,
    Identifier,
    IndexAccess,
    IntType,
    Mapping,
    MappingType,
    MemberAccess,
    PointerType,
    replaceNode,
    SourceUnit,
    StateVariableVisibility,
    StructDefinition,
    TupleExpression,
    TypeName,
    TypeNode,
    UnaryOperation,
    UncheckedBlock,
    UserDefinedType,
    UserDefinedTypeName,
    VariableDeclaration
} from "solc-typed-ast";
import { single } from "../util/misc";
import { UnsupportedConstruct } from "./instrument";
import { InstrumentationContext } from "./instrumentation_context";
import { ConcreteDatastructurePath, findStateVarUpdates } from "./state_vars";
import { explodeTupleAssignment } from "./state_var_instrumenter";
import { InstrumentationSiteType } from "./transpiling_context";
import { needsLocation } from "./utils";

export type AbsDatastructurePath = Array<null | string>;
export type StateVarRefDesc = [Expression, VariableDeclaration, ConcreteDatastructurePath, boolean];

/**
 * Given a TypeName `typ` and a `DatastructurePath` `path`, find the part of `typ` that corresponds to `path`.
 * `idx` is used internaly in the recursion to keep track of where we are in the path.
 */
function lookupPathInType(typ: TypeName, path: AbsDatastructurePath, idx = 0): TypeName {
    if (idx === path.length) {
        return typ;
    }

    const el = path[idx];

    if (el === null) {
        if (typ instanceof ArrayTypeName) {
            return lookupPathInType(typ.vBaseType, path, idx + 1);
        }

        if (typ instanceof Mapping) {
            return lookupPathInType(typ.vValueType, path, idx + 1);
        }

        // Handle case when the value type is a mapping that has already been
        // interposed.
        // @todo the check here is too loose
        if (
            typ instanceof UserDefinedTypeName &&
            typ.vReferencedDeclaration instanceof StructDefinition &&
            typ.vReferencedDeclaration.name === "S"
        ) {
            const valueT = single(
                typ.vReferencedDeclaration.vMembers.filter((field) => field.name === "innerM")
            ).vType;

            assert(
                valueT instanceof Mapping,
                `Expected struct ${typ.path ? typ.path.name : typ.name} to contain field innerM`
            );

            return lookupPathInType(valueT.vValueType, path, idx + 1);
        }
        throw new Error(`Unexpected type ${typ.constructor.name} for index path element`);
    }

    assert(
        typ instanceof UserDefinedTypeName &&
            typ.vReferencedDeclaration instanceof StructDefinition,
        `Expected user defined struct for path element ${el}`
    );

    const field = single(
        typ.vReferencedDeclaration.vMembers.filter((field) => field.name === el),
        `No field matching element path ${el} in struct ${typ.vReferencedDeclaration.name}`
    );

    assert(field.vType !== undefined, `Expected field ${field.name} to have a type`);

    return lookupPathInType(field.vType, path, idx + 1);
}

function pathMatch(a: AbsDatastructurePath, b: ConcreteDatastructurePath): boolean {
    if (a.length + 1 !== b.length) {
        return false;
    }

    for (let i = 0; i < a.length; i++) {
        if (a[i] === null && b[i] instanceof Expression) {
            continue;
        }

        if (typeof a[i] === "string" && typeof b[i] === "string" && a[i] === b[i]) {
            continue;
        }

        return false;
    }

    assert(
        b[a.length] instanceof Expression,
        `Expected last element in path to be an index expression, not ${b[a.length]}`
    );
    return true;
}

function splitExpr(e: Expression): [Expression, Expression] {
    assert(
        e instanceof IndexAccess && e.vIndexExpression !== undefined,
        `splitExpr expects an index access, not ${e.constructor.name}`
    );
    return [e.vBaseExpression, e.vIndexExpression];
}

function replaceAssignmentHelper(
    instrCtx: InstrumentationContext,
    assignment: Assignment,
    lib: ContractDefinition,
    newValT: TypeNode
): void {
    const factory = instrCtx.factory;
    let newVal = assignment.vRightHandSide;
    const [base, index] = splitExpr(assignment.vLeftHandSide);

    if (assignment.operator !== "=") {
        const getter = instrCtx.libToMapGetterMap.get(lib, false);
        const baseCopy = factory.copy(base);
        const idxCopy = factory.copy(index);

        baseCopy.src = base.src;
        idxCopy.src = index.src;

        const oldVal = factory.makeFunctionCall(
            "<missing>",
            FunctionCallKind.FunctionCall,
            factory.mkLibraryFunRef(instrCtx, getter),
            [baseCopy, idxCopy]
        );

        oldVal.src = assignment.vLeftHandSide.src;

        const op = assignment.operator.slice(0, -1);
        newVal = factory.makeBinaryOperation("<missing>", op, oldVal, newVal);

        instrCtx.addGeneralInstrumentation(newVal);
    }

    const newNode = factory.makeFunctionCall(
        "<missing>",
        FunctionCallKind.FunctionCall,
        factory.mkLibraryFunRef(instrCtx, instrCtx.libToMapSetterMap.get(lib, newValT)),
        [base, index, newVal]
    );

    replaceNode(assignment, newNode);
    // Make sure that the setter call maps to the original assignment node
    newNode.src = assignment.src;
}

export function findAllStateVarReferences(units: SourceUnit[]): StateVarRefDesc[] {
    const res: StateVarRefDesc[] = [];

    for (const unit of units) {
        for (const ref of unit.getChildrenBySelector<Identifier | MemberAccess>(
            (nd) =>
                (nd instanceof Identifier || nd instanceof MemberAccess) &&
                nd.vReferencedDeclaration instanceof VariableDeclaration &&
                nd.vReferencedDeclaration.stateVariable
        )) {
            let expr: Expression = ref;
            const isRValueInLValue = isAccessRValueInLValue(ref);
            const stateVar = ref.vReferencedDeclaration as VariableDeclaration;
            const path: ConcreteDatastructurePath = [];

            while (true) {
                res.push([
                    expr,
                    stateVar,
                    [...path] as ConcreteDatastructurePath,
                    isRValueInLValue
                ]);
                const pt = expr.parent;

                if (
                    !(
                        (pt instanceof IndexAccess && expr === pt.vBaseExpression) ||
                        pt instanceof MemberAccess
                    )
                ) {
                    break;
                }

                path.push(
                    pt instanceof IndexAccess ? (pt.vIndexExpression as Expression) : pt.memberName
                );

                expr = pt;
            }
        }
    }

    return res;
}

/**
 * Returns true if the IndexAccess `node` (e.g. base[key]) is such that its part of
 * an update, and the update happens to same part of `base[key]`, but not the whole `base[key]`.
 *
 * Here are several examples where `base[key]` should be true:
 *
 * base[key][key1] = val;
 * (base[key][key3], foo) = bar();
 * base[key].boo++;
 *
 * And several examples where it should return false:
 *
 * base[key] = val; // update is to the whole part
 * delete base[key]; // we don't count updates as deletions in this case
 * base[key]--;
 */
function isAccessRValueInLValue(node: Expression): boolean {
    let ref: Expression = node;

    // Not a part of `base[key]` is selected
    if (!(ref.parent instanceof MemberAccess || ref.parent instanceof IndexAccess)) {
        return false;
    }

    while (true) {
        const pt: ASTNode | undefined = ref.parent;

        if (pt instanceof MemberAccess) {
            ref = pt;
            continue;
        }

        if (pt instanceof IndexAccess) {
            // `base[key]` is part of some index expression and thus not re-assigned. Eg. `foo[base[key][key1]] = 1`
            if (ref !== pt.vBaseExpression) {
                return false;
            }
            ref = pt;
            continue;
        }

        if (pt instanceof TupleExpression) {
            // Inline arrays can appear only on the RHS
            if (pt.isInlineArray) {
                return false;
            }

            ref = pt;
            continue;
        }

        if (pt instanceof Assignment) {
            return ref === pt.vLeftHandSide;
        }

        if (pt instanceof UnaryOperation) {
            return (ref === pt.vSubExpression && pt.operator === "++") || pt.operator === "--";
        }

        if (pt instanceof FunctionCall) {
            return (
                ref === pt.vExpression &&
                (pt.vFunctionName === "push" || pt.vFunctionName === "pop") &&
                pt.vFunctionCallType === ExternalReferenceType.Builtin
            );
        }

        return false;
    }
}

/**
 * Given a state variable `stateVar` and a DatastructurePath `path`, let `path`
 * reference the part `T` of `stateVar` (`T` is the whole variable when `path` is empty).
 *
 * If `T` is not a mapping an error is thrown. Otherwise:
 *
 * 0. Generate a custom library implementation `L` for the mapping type of `T`
 * 1. Replace the type of `T` in the `stateVar` declaration with `L.S`.
 * 2. Replace all var index updates with L.set(<base>, <key>, <newVal>) or L.deleteKey(<base>, <key>)
 * 3. Replace all index accesses `<base>[<key>]` on `T` with `L.get(<base>, <key>)`
 */
export function interposeMap(
    instrCtx: InstrumentationContext,
    targets: Array<[VariableDeclaration, AbsDatastructurePath]>,
    units: SourceUnit[]
): void {
    const allUpdates = findStateVarUpdates(units, instrCtx);
    const allRefs = findAllStateVarReferences(units);
    const allRefsMap = new Map<Expression, StateVarRefDesc>(allRefs.map((x) => [x[0], x]));

    // Sort in order of decreasing datastructure path length. This way if we are
    // interposing on both maps in `mapping(uint => mapping(uint => uint))` We
    // will first interpose on the inner `mapping(uint=>uint)` and then on the
    // outer map.
    targets.sort((a, b) => b[1].length - a[1].length);

    const mapTs = targets.map(([stateVar, path]) =>
        lookupPathInType(stateVar.vType as TypeName, path)
    );
    const factory = instrCtx.factory;

    for (let i = 0; i < targets.length; i++) {
        const [stateVar, path] = targets[i];
        const mapT = mapTs[i];

        assert(
            mapT instanceof Mapping,
            `Referenced state var (part) must be mapping, not ${mapT.constructor.name}`
        );

        const keyT = instrCtx.typeEnv.inference.typeNameToTypeNode(mapT.vKeyType);
        const valueT = instrCtx.typeEnv.inference.typeNameToTypeNode(mapT.vValueType);

        // 0. Generate custom library implementation
        const lib = instrCtx.typesToLibraryMap.get(
            keyT,
            valueT,
            stateVar.getClosestParentByType(SourceUnit) as SourceUnit
        );
        const struct = single(lib.vStructs);

        instrCtx.sVarToLibraryMap.set(lib, stateVar, path);

        // 1. Replace the type of `T` in the `stateVar` declaration with `L.S`
        const newMapT = factory.makeUserDefinedTypeName(
            "<missing>",
            `${lib.name}.${struct.name}`,
            struct.id
        );

        replaceNode(mapT, newMapT);

        if (stateVar.vValue !== undefined) {
            throw new UnsupportedConstruct(
                `Can't instrument state variable ${stateVar.name} containing a map, with an inline initializer.`,
                stateVar,
                instrCtx.files
            );
        }

        // 2. Replace all var index updates with L.set(<base>, <key>, <newVal>) or L.deleteKey(<base>, <key>)
        const curVarUpdates = allUpdates.filter(([, v]) => v === stateVar);

        for (const [updateNode, , updPath, , newValT] of curVarUpdates) {
            // Only interested in updates to the correct part of the state var
            if (!pathMatch(path, updPath)) {
                continue;
            }

            if (updateNode instanceof Array) {
                const [assignment, lhsPath] = updateNode;
                const containingFun = assignment.getClosestParentByType(
                    FunctionDefinition
                ) as FunctionDefinition;

                // Simple non-tuple case
                if (lhsPath.length === 0) {
                    assert(
                        newValT !== undefined,
                        `Unexpected missing new value in {0}`,
                        assignment
                    );
                    replaceAssignmentHelper(instrCtx, assignment, lib, newValT);
                    allRefsMap.delete(assignment.vLeftHandSide);
                } else {
                    // Tuple assignment case.
                    // @todo Do we need a new instrumentation type here?

                    const transCtx = instrCtx.transCtxMap.get(
                        containingFun,
                        InstrumentationSiteType.TwoPointWrapper
                    );

                    for (const [tempAssignment, tuplePath] of explodeTupleAssignment(
                        transCtx,
                        assignment
                    )) {
                        if (eq(tuplePath, lhsPath)) {
                            assert(
                                newValT !== undefined,
                                `Unexpected missing new value in {0}`,
                                assignment
                            );

                            replaceAssignmentHelper(instrCtx, tempAssignment, lib, newValT);
                            allRefsMap.delete(tempAssignment.vLeftHandSide);
                        }
                    }
                }
            } else if (updateNode instanceof UnaryOperation) {
                const [base, index] = splitExpr(updateNode.vSubExpression);

                if (updateNode.operator === "delete") {
                    assert(
                        updateNode.parent instanceof ExpressionStatement,
                        `delete operator can only be used as a statement`
                    );

                    const deleteKeyF = factory.mkLibraryFunRef(
                        instrCtx,
                        instrCtx.libToDeleteFunMap.get(lib)
                    );

                    const newNode = factory.makeFunctionCall(
                        "<missing>",
                        FunctionCallKind.FunctionCall,
                        deleteKeyF,
                        [base, index]
                    );

                    replaceNode(updateNode, newNode);
                    allRefsMap.delete(updateNode.vSubExpression);
                    // Make sure the delete call maps to the original node
                    newNode.src = updateNode.src;
                } else {
                    assert(
                        updateNode.operator === "++" || updateNode.operator == "--",
                        `Expected ++/-- operator, not ${updateNode.operator}`
                    );
                    const isUnchecked =
                        updateNode.getClosestParentByType(UncheckedBlock) !== undefined;

                    const incDecF = factory.mkLibraryFunRef(
                        instrCtx,
                        instrCtx.libToMapIncDecMap.get(
                            lib,
                            updateNode.operator,
                            updateNode.prefix,
                            isUnchecked
                        )
                    );

                    const newNode = factory.makeFunctionCall(
                        "<missing>",
                        FunctionCallKind.FunctionCall,
                        incDecF,
                        [base, index]
                    );

                    replaceNode(updateNode, newNode);
                    allRefsMap.delete(updateNode.vSubExpression);
                    // Make sure the unary op call maps to the original node
                    newNode.src = updateNode.src;
                }
            } else {
                /**
                 * Note that:
                 *
                 * 1) .push() and .pop() are handled by replacing IndexAccess-es
                 * 2) We dont need to worry about state var initializers, as those can't assign values to maps (the VariableDeclaration case)
                 */
                assert(
                    updateNode instanceof FunctionCall,
                    `NYI wrapping map update ${updateNode.constructor.name}`
                );
            }
        }

        replaceNode(mapT, newMapT);
    }

    // 3. Replace all index accesses `<base>[<key>]` on `T` with `L.get(<base>, <key>)`
    // Note: This has to be done after the assignment for ALL targets are processed, so that
    // we can accumulate the set of all access that appear on the LHS of an update.
    for (let i = 0; i < targets.length; i++) {
        const [stateVar, path] = targets[i];

        // Get the custom library implementation
        const lib = instrCtx.sVarToLibraryMap.mustGet(stateVar, path);

        for (const [refNode, refVar, refPath, isRvalueInLValue] of allRefsMap.values()) {
            if (
                !(refVar === stateVar && pathMatch(path, refPath) && refNode instanceof IndexAccess)
            ) {
                continue;
            }

            const [base, index] = splitExpr(refNode);
            const getterF = factory.mkLibraryFunRef(
                instrCtx,
                instrCtx.libToMapGetterMap.get(lib, isRvalueInLValue)
            );

            const newNode = factory.makeFunctionCall(
                "<misisng>",
                FunctionCallKind.FunctionCall,
                getterF,
                [base, index]
            );

            replaceNode(refNode, newNode);

            // Make sure the getter call maps to the original node
            newNode.src = refNode.src;
        }
    }

    // Make public state variables we are interposing on private, and generate a custom getter for them
    for (const sVar of new Set(targets.map((t) => t[0]))) {
        if (sVar.visibility !== StateVariableVisibility.Public) {
            continue;
        }

        sVar.visibility = StateVariableVisibility.Default;

        const getter = interposeGetter(instrCtx, sVar, units);

        if (sVar.vOverrideSpecifier) {
            getter.vOverrideSpecifier = sVar.vOverrideSpecifier;
            sVar.vOverrideSpecifier = undefined;
        }
    }
}

function interposeGetter(
    ctx: InstrumentationContext,
    v: VariableDeclaration,
    units: SourceUnit[]
): FunctionDefinition {
    assert(v.stateVariable, `interposeGetter exects a state variable, not ${v.name}`);

    const factory = ctx.factory;
    const contract = v.vScope as ContractDefinition;

    let typ = v.vType;

    assert(typ !== undefined, `State var ${v.name} is missing a type`);

    const fn = factory.addEmptyFun(ctx, v.name, FunctionVisibility.Public, contract);

    fn.stateMutability = FunctionStateMutability.View;

    let expr: Expression = factory.makeIdentifierFor(v);

    while (true) {
        if (typ instanceof ArrayTypeName || typ instanceof Mapping) {
            let idxT =
                typ instanceof ArrayTypeName
                    ? new IntType(256, false)
                    : ctx.typeEnv.inference.typeNameToTypeNode(typ.vKeyType);

            if (needsLocation(idxT)) {
                idxT = new PointerType(idxT, DataLocation.Memory);
            }

            const idxArg = factory.addFunArg(
                ctx.nameGenerator.getFresh("ARG_"),
                idxT,
                DataLocation.Default,
                fn
            );

            expr = factory.makeIndexAccess(`<missing>`, expr, factory.makeIdentifierFor(idxArg));
            typ = typ instanceof ArrayTypeName ? typ.vBaseType : typ.vValueType;

            continue;
        }

        if (
            typ instanceof UserDefinedTypeName &&
            typ.vReferencedDeclaration instanceof StructDefinition &&
            typ.vReferencedDeclaration.vScope instanceof ContractDefinition &&
            ctx.typesToLibraryMap.isLib(typ.vReferencedDeclaration.vScope)
        ) {
            const lib = typ.vReferencedDeclaration.vScope;
            const getter = ctx.libToMapGetterMap.get(lib, false);

            const idxArg = factory.addFunArg(
                ctx.nameGenerator.getFresh("ARG_"),
                getter.vParameters.vParameters[1].vType as TypeName,
                getter.vParameters.vParameters[1].storageLocation,
                fn
            );

            expr = factory.makeFunctionCall(
                "<missing>",
                FunctionCallKind.FunctionCall,
                factory.mkLibraryFunRef(ctx, getter),
                [expr, factory.makeIdentifierFor(idxArg)]
            );

            typ = single(getter.vReturnParameters.vParameters).vType as TypeName;

            continue;
        }

        break;
    }

    const exprT = ctx.typeEnv.inference.typeNameToTypeNode(typ);

    if (exprT instanceof UserDefinedType && exprT.definition instanceof StructDefinition) {
        throw new Error(`We don't support interposing on public state variables returning structs`);
    }

    assert(
        !(
            exprT instanceof ArrayType ||
            exprT instanceof MappingType ||
            exprT instanceof PointerType
        ) && !needsLocation(exprT),
        "Unsupported return type for public getter of {0}: {1}",
        v.name,
        exprT
    );

    factory.addFunRet(ctx, ctx.nameGenerator.getFresh("RET_"), exprT, DataLocation.Default, fn);
    factory.addStmt(fn, factory.makeReturn(fn.vReturnParameters.id, expr));

    // Finally rename the variable itself so it doesn't clash with the getter
    v.name = ctx.nameGenerator.getFresh(v.name);

    for (const unit of units) {
        for (const ref of unit.getChildrenBySelector(
            (n) =>
                (n instanceof Identifier || n instanceof MemberAccess) &&
                n.referencedDeclaration === v.id
        )) {
            if (ref instanceof Identifier) {
                ref.name = v.name;
            } else {
                (ref as MemberAccess).memberName = v.name;
            }
        }
    }

    return fn;
}
