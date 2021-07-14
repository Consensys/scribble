import {
    ArrayType,
    ArrayTypeName,
    assert,
    Assignment,
    ContractDefinition,
    DataLocation,
    eq,
    Expression,
    ExpressionStatement,
    FunctionCall,
    FunctionCallKind,
    FunctionDefinition,
    FunctionVisibility,
    Identifier,
    IndexAccess,
    IntType,
    Mapping,
    MappingType,
    MemberAccess,
    Mutability,
    PointerType,
    replaceNode,
    SourceUnit,
    StateVariableVisibility,
    StructDefinition,
    TypeName,
    typeNameToTypeNode,
    UnaryOperation,
    UserDefinedType,
    UserDefinedTypeName,
    VariableDeclaration
} from "solc-typed-ast";
import {
    addEmptyFun,
    addFunArg,
    addFunRet,
    addStmt,
    ConcreteDatastructurePath,
    explodeTupleAssignment,
    findStateVarUpdates,
    needsLocation,
    single,
    StateVarRefDesc,
    UnsupportedConstruct
} from "..";
import { InstrumentationContext } from "./instrumentation_context";
import { InstrumentationSiteType } from "./transpiling_context";

export type AbsDatastructurePath = Array<null | string>;

/**
 * Given a TypeName `typ` and a `DatastructurePath` `path`, find the part of `typ` that corresponds to `path`.
 * `idx` is used internaly in the recursion to keep track of where we are in the path.
 *
 * @param typ
 * @param path
 * @param idx
 * @returns
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
            assert(valueT instanceof Mapping, ``);

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

    assert(field.vType !== undefined, ``);

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

    assert(b[a.length] instanceof Expression, ``);
    return true;
}

function splitExpr(e: Expression): [Expression, Expression] {
    assert(e instanceof IndexAccess && e.vIndexExpression !== undefined, ``);
    return [e.vBaseExpression, e.vIndexExpression];
}

function mkLibraryFunRef(ctx: InstrumentationContext, fn: FunctionDefinition): MemberAccess {
    const factory = ctx.factory;
    const ref = factory.makeMemberAccess(
        "<missing>",
        factory.makeIdentifierFor(fn.vScope as ContractDefinition),
        fn.name,
        fn.id
    );
    ctx.addGeneralInstrumentation(ref);
    return ref;
}

function replaceAssignmentHelper(
    instrCtx: InstrumentationContext,
    assignment: Assignment,
    lib: ContractDefinition
): void {
    const factory = instrCtx.factory;
    const newVal = assignment.vRightHandSide;
    const [base, index] = splitExpr(assignment.vLeftHandSide);

    const newNode = factory.makeFunctionCall(
        "<missing>",
        FunctionCallKind.FunctionCall,
        mkLibraryFunRef(instrCtx, instrCtx.getCustomMapSetter(lib, newVal)),
        [base, index, newVal]
    );

    replaceNode(assignment, newNode);
    // Make sure that the setter call maps to the original assignment node
    newNode.src = assignment.src;
}

/**
 * Given a reference ot a state var `ref`, and a datasturcture path `path`, see if
 * `ref` is the base of an `IndexAccess` that accesses an index INSIDE the part of the state
 * var pointed to by `path`.
 * @param ref
 * @param path
 * @returns
 */
function getStateVarRefDesc(
    ref: Identifier | MemberAccess,
    path: AbsDatastructurePath
): StateVarRefDesc | undefined {
    assert(
        ref.vReferencedDeclaration instanceof VariableDeclaration &&
            ref.vReferencedDeclaration.stateVariable,
        ""
    );

    const stateVar = ref.vReferencedDeclaration;
    const concretePath: ConcreteDatastructurePath = [];
    let expr: Expression = ref;

    for (let i = 0; i < path.length; i++) {
        const el = path[i];
        const pt = expr.parent;

        if (el === null) {
            if (!(pt instanceof IndexAccess && expr === pt.vBaseExpression)) {
                return undefined;
            }

            assert(pt.vIndexExpression !== undefined, ``);
            concretePath.push(pt.vIndexExpression);
        } else {
            if (!(pt instanceof MemberAccess && pt.memberName === el)) {
                return undefined;
            }
            concretePath.push(pt.memberName);
        }

        expr = pt;
    }

    if (!(expr.parent instanceof IndexAccess && expr === expr.parent.vBaseExpression)) {
        return undefined;
    }

    return [expr.parent, stateVar, concretePath];
}

export function findStateVarReferences(
    units: SourceUnit[],
    stateVar: VariableDeclaration,
    path: AbsDatastructurePath
): StateVarRefDesc[] {
    const res: StateVarRefDesc[] = [];

    for (const unit of units) {
        for (const ref of unit.getChildrenBySelector<Identifier | MemberAccess>(
            (nd) =>
                (nd instanceof Identifier || nd instanceof MemberAccess) &&
                nd.vReferencedDeclaration instanceof VariableDeclaration &&
                nd.vReferencedDeclaration === stateVar
        )) {
            const refDesc = getStateVarRefDesc(ref, path);

            if (refDesc) {
                res.push(refDesc);
            }
        }
    }

    return res;
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
 *
 * @param stateVar
 * @param path
 */
export function interposeMap(
    instrCtx: InstrumentationContext,
    targets: Array<[VariableDeclaration, AbsDatastructurePath]>,
    units: SourceUnit[]
): void {
    const allUpdates = findStateVarUpdates(units);

    // Sort in order of decreasing datastructure path length. This way if we are
    // interposing on both maps in `mapping(uint => mapping(uint => uint))` We
    // will first interpose on the inner `mapping(uint=>uint)` and then on the
    // outer map.
    targets.sort((a, b) => (a[1].length > b[1].length ? -1 : a[1].length == b[1].length ? 0 : 1));

    const mapTs = targets.map(([stateVar, path]) =>
        lookupPathInType(stateVar.vType as TypeName, path)
    );
    const factory = instrCtx.factory;

    for (let i = 0; i < targets.length; i++) {
        const stateVar = targets[i][0];
        const path = targets[i][1];
        const mapT = mapTs[i];

        assert(
            mapT instanceof Mapping,
            `Referenced state var (part) must be mapping, not ${mapT.constructor.name}`
        );

        const keyT = typeNameToTypeNode(mapT.vKeyType);
        const valueT = typeNameToTypeNode(mapT.vValueType);

        // 0. Generate custom library implementation
        const lib = instrCtx.getCustomMapLibrary(keyT, valueT);
        const struct = instrCtx.getCustomMapStruct(lib);
        instrCtx.setMapInterposingLibrary(stateVar, path, lib);

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

        for (const [updateNode, , updPath] of curVarUpdates) {
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
                    replaceAssignmentHelper(instrCtx, assignment, lib);
                } else {
                    // Tuple assignment case.
                    // @todo Do we need a new instrumentation type here?

                    const transCtx = instrCtx.getTranspilingCtx(
                        containingFun,
                        InstrumentationSiteType.StateVarUpdated
                    );

                    for (const [tempAssignment, tuplePath] of explodeTupleAssignment(
                        transCtx,
                        assignment
                    )) {
                        if (eq(tuplePath, lhsPath)) {
                            replaceAssignmentHelper(instrCtx, tempAssignment, lib);
                        }
                    }
                }
            } else if (updateNode instanceof UnaryOperation) {
                const [base, index] = splitExpr(updateNode.vSubExpression);

                if (updateNode.operator === "delete") {
                    assert(updateNode.parent instanceof ExpressionStatement, ``);
                    const deleteKeyF = mkLibraryFunRef(
                        instrCtx,
                        instrCtx.getCustomMapDeleteKey(lib)
                    );

                    const newNode = factory.makeFunctionCall(
                        "<missing>",
                        FunctionCallKind.FunctionCall,
                        deleteKeyF,
                        [base, index]
                    );
                    replaceNode(updateNode, newNode);
                    // Make sure the delete call maps to the original node
                    newNode.src = updateNode.src;
                } else {
                    assert(updateNode.operator === "++" || updateNode.operator == "--", ``);
                    const incDecF = mkLibraryFunRef(
                        instrCtx,
                        instrCtx.getCustomMapIncDec(lib, updateNode.operator, updateNode.prefix)
                    );

                    const newNode = factory.makeFunctionCall(
                        "<missing>",
                        FunctionCallKind.FunctionCall,
                        incDecF,
                        [base, index]
                    );
                    replaceNode(updateNode, newNode);
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

        // 3. Replace all index accesses `<base>[<key>]` on `T` with `L.get(<base>, <key>)`
        // All remaining references to the state var (and its part) that occur on
        // the LHS of some assignments have been handled in step 2. Therefore we can
        // replace the occuring references with calls to `L.get()`
        for (const [refNode] of findStateVarReferences(units, stateVar, path)) {
            const [base, index] = splitExpr(refNode);
            const getterF = mkLibraryFunRef(instrCtx, instrCtx.getCustomMapGetter(lib));
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
        interposeGetter(instrCtx, sVar, units);
    }
}

function interposeGetter(
    ctx: InstrumentationContext,
    v: VariableDeclaration,
    units: SourceUnit[]
): FunctionDefinition {
    assert(v.stateVariable, ``);
    const factory = ctx.factory;
    const contract = v.vScope as ContractDefinition;
    let typ = v.vType;

    assert(typ !== undefined, ``);
    const fn = addEmptyFun(ctx, v.name, FunctionVisibility.Public, contract);
    let expr: Expression = factory.makeIdentifierFor(v);

    while (true) {
        if (typ instanceof ArrayTypeName || typ instanceof Mapping) {
            let idxT =
                typ instanceof ArrayTypeName
                    ? new IntType(256, false)
                    : typeNameToTypeNode(typ.vKeyType);

            if (needsLocation(idxT)) {
                idxT = new PointerType(idxT, DataLocation.Memory);
            }

            const idxArg = addFunArg(
                factory,
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
            ctx.isCustomMapLibrary(typ.vReferencedDeclaration.vScope)
        ) {
            const lib = typ.vReferencedDeclaration.vScope;
            const getter = ctx.getCustomMapGetter(lib);
            const idxT = getter.vParameters.vParameters[1].vType as TypeName;

            const idxArg = factory.makeVariableDeclaration(
                false,
                false,
                ctx.nameGenerator.getFresh("ARG_"),
                fn.id,
                false,
                getter.vParameters.vParameters[1].storageLocation,
                StateVariableVisibility.Default,
                Mutability.Mutable,
                "<missing>",
                undefined,
                idxT
            );
            fn.vParameters.appendChild(idxArg);

            expr = factory.makeFunctionCall(
                "<missing>",
                FunctionCallKind.FunctionCall,
                mkLibraryFunRef(ctx, getter),
                [expr, factory.makeIdentifierFor(idxArg)]
            );

            typ = single(getter.vReturnParameters.vParameters).vType as TypeName;
            continue;
        }

        break;
    }

    const exprT = typeNameToTypeNode(typ);

    if (exprT instanceof UserDefinedType && exprT.definition instanceof StructDefinition) {
        throw new Error(`We don't support interposing on public state variables returning structs`);
    }

    assert(
        !(
            exprT instanceof ArrayType ||
            exprT instanceof MappingType ||
            exprT instanceof PointerType
        ) && !needsLocation(exprT),
        `Unsupported return type for public getter of ${v.name}: ${exprT.pp()}`
    );

    addFunRet(ctx, ctx.nameGenerator.getFresh("RET_"), exprT, DataLocation.Default, fn);
    addStmt(factory, fn, factory.makeReturn(fn.vReturnParameters.id, expr));

    // Finally rename the variable itsel so it doesn't clash with the getter
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