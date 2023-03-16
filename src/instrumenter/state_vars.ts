import {
    ArrayTypeName,
    assert,
    Assignment,
    ASTNode,
    Conditional,
    ContractDefinition,
    ContractKind,
    DataLocation,
    ElementaryTypeName,
    ErrorDefinition,
    EventDefinition,
    Expression,
    ExternalReferenceType,
    FunctionCall,
    FunctionCallKind,
    FunctionDefinition,
    FunctionKind,
    FunctionTypeName,
    Identifier,
    IndexAccess,
    InferType,
    InheritanceSpecifier,
    Mapping,
    MemberAccess,
    ModifierDefinition,
    ModifierInvocation,
    ParameterList,
    Return,
    SourceUnit,
    StructDefinition,
    TupleExpression,
    TupleType,
    TypeName,
    TypeNode,
    UnaryOperation,
    UserDefinedTypeName,
    VariableDeclaration,
    VariableDeclarationStatement
} from "solc-typed-ast";
import { print, single, zip } from "../util/misc";
import { InstrumentationContext } from "./instrumentation_context";

export type LHS = Expression | VariableDeclaration | [Expression, string];
export type RHS = Expression | [Expression, number];

/**
 * Given potentially complex assignments involving tuples and function return desugaring, return an
 * iterable of all the primitive assignments happening between. (i.e. assignments where the LHS is not a tuple)
 */
function* getAssignmentComponents(
    lhs: Expression | VariableDeclarationStatement,
    rhs: Expression
): Iterable<[LHS, RHS]> {
    if (lhs instanceof TupleExpression || lhs instanceof VariableDeclarationStatement) {
        let assignedDecls: Array<null | VariableDeclaration | Expression>;

        if (lhs instanceof TupleExpression) {
            assignedDecls = lhs.vOriginalComponents;
        } else {
            assignedDecls = lhs.assignments.map((declId) =>
                declId === null ? null : (lhs.requiredContext.locate(declId) as VariableDeclaration)
            );
        }

        if (assignedDecls.length === 1) {
            if (assignedDecls[0] !== null) {
                yield* getAssignmentComponents(assignedDecls[0], rhs);
            }
        } else if (rhs instanceof TupleExpression) {
            assert(
                assignedDecls.length === rhs.vOriginalComponents.length,
                "Mismatch in declarations: {0} and {1}",
                assignedDecls,
                rhs.vOriginalComponents
            );

            for (let i = 0; i < assignedDecls.length; i++) {
                const lhsComp = assignedDecls[i];

                if (lhsComp === null) {
                    continue;
                }

                const rhsComp = rhs.vOriginalComponents[i];
                // Skip assignments where LHS is omitted
                assert(rhsComp !== null, "Unexpected null in rhs of {0} in position {1}", rhs, i);

                yield* getAssignmentComponents(lhsComp, rhsComp);
            }
        } else if (rhs instanceof FunctionCall) {
            for (let i = 0; i < assignedDecls.length; i++) {
                const lhsComp = assignedDecls[i];
                // Skip assignments where LHS is omitted
                if (lhsComp === null) {
                    continue;
                }

                yield [lhsComp, [rhs, i]];
            }
        } else if (rhs instanceof Conditional) {
            yield* getAssignmentComponents(lhs, rhs.vTrueExpression);
            yield* getAssignmentComponents(lhs, rhs.vFalseExpression);
        } else {
            assert(false, "Unexpected rhs in tuple assignment", rhs);
        }
    } else {
        yield [lhs, rhs];
    }
}

/**
 * Find all explicit and implicit assignments that occur within `node`. These include:
 *
 *  1) Normal assignments - `a = 1` yields [a, 1]
 *
 *  2) Tuple assignments - these are broken down into primitive assignments.
 *  E.g. (a,b) = (1,2) yields [[a,1], [b,2]];
 *
 *  3) Tuple assignments with function returns. E.g (a,b) = foo(); yields [[a,
 *  [foo(), 0]], [b, [foo(), 1]]]
 *
 *  4) Variable declaration statements. E.g. (uint a = 1) yields [uint a, 1].
 *  Tuples and function are handled similarly to normal assignments.
 *
 *  5) Function calls. The passing of arguments is an implicit assignment. E.g:
 *  ```
 *  function foo(uint x, uint y) ...
 *  ...
 *      foo(1, 2);
 * ```
 *   Yields [[uint x, 1], [uint y, 2]]
 *
 *  6) Modifier invocations - handled similarly to function calls
 *
 *  7) Function returns - handle similarly to function arguments passing
 *
 *  8) Inline state variable initialization/file level constant initailization
 *
 *  9) Base constructor calls (using InheritanceSpecifiers)
 *
 * Returns a list of [lhs, rhs] tuples.
 */
export function* getAssignments(node: ASTNode): Iterable<[LHS, RHS]> {
    /**
     * Given a list of formal parameters/returns `formals` and actual values that are assigned to them `actuals`
     * return a list of assignments. This handles several cases:
     *
     * 1) Normal function call - e.g. foo(1,2) where foo is defined as foo(uint x, int8 y) returns [[uint x, 1], [int8 y, 2]]
     * 2) Library function call - e.g. arr.extend(otherArr) where extend is defined in a library as `function extend(uint[] a1, uint[] a2)` returns
     *      [[uint[] a1, arr], [uint[] a2, otherArr]]
     * 3) Return with a single value  - e.g. `return 1;` in a function with `returns (uint RET)` returns [[uint RET, 1]]
     * 4) Return with tuples - e.g. `return (1,2)` in a function with `returns (uint RET0, RET1)` returns [[uint RET0, 1], [uint RET1, 2]]
     *
     *
     * @param formals
     * @param actuals
     * @returns
     */
    const helper = (
        formals: VariableDeclaration[],
        actuals: Expression[] | Expression
    ): Iterable<[LHS, RHS]> => {
        if (formals.length === 1) {
            if (actuals instanceof Array) {
                return zip(formals, actuals);
            }

            return [[formals[0], actuals]];
        }

        if (actuals instanceof Array) {
            return zip(formals, actuals);
        }

        if (actuals instanceof TupleExpression) {
            assert(
                actuals.vComponents.length === actuals.vOriginalComponents.length,
                "Expected tuple to not have placeholders",
                actuals
            );

            return zip(formals, actuals.vComponents);
        }

        if (actuals instanceof FunctionCall) {
            const callRets: Array<[FunctionCall, number]> = (
                actuals.vReferencedDeclaration as FunctionDefinition
            ).vReturnParameters.vParameters.map<[FunctionCall, number]>((decl, i) => [actuals, i]);

            return zip(formals, callRets);
        }

        assert(false, "Unexpected rhs {0} for lhs {1}", actuals, formals);
    };

    for (const candidate of node.getChildrenBySelector(
        (n) =>
            n instanceof Assignment ||
            n instanceof VariableDeclarationStatement ||
            n instanceof FunctionCall ||
            n instanceof Return ||
            n instanceof ModifierInvocation ||
            n instanceof VariableDeclaration ||
            n instanceof InheritanceSpecifier
    )) {
        if (candidate instanceof Assignment) {
            yield* getAssignmentComponents(candidate.vLeftHandSide, candidate.vRightHandSide);
        } else if (candidate instanceof VariableDeclarationStatement) {
            if (candidate.vInitialValue === undefined) {
                continue;
            }

            const rhs = candidate.vInitialValue;

            yield* getAssignmentComponents(candidate, rhs);
        } else if (candidate instanceof FunctionCall || candidate instanceof ModifierInvocation) {
            // Account for implicit assignments to callee formal parameters.

            // Handle struct constructors as a special case
            if (
                candidate instanceof FunctionCall &&
                candidate.kind === FunctionCallKind.StructConstructorCall
            ) {
                const structDecl = (candidate.vExpression as UserDefinedTypeName)
                    .vReferencedDeclaration as StructDefinition;

                const fieldNames =
                    candidate.fieldNames !== undefined
                        ? candidate.fieldNames
                        : structDecl.vMembers
                              .filter((decl) => !(decl.vType instanceof Mapping))
                              .map((decl) => decl.name);

                assert(
                    fieldNames.length === candidate.vArguments.length,
                    "Expected struct field names to correspond to call arguments"
                );

                for (let i = 0; i < fieldNames.length; i++) {
                    yield [[candidate, fieldNames[i]], candidate.vArguments[i]];
                }

                continue;
            }

            // Skip type conversions (handled in findAliasedStateVars) and builtin calls
            if (
                candidate instanceof FunctionCall &&
                (candidate.kind !== FunctionCallKind.FunctionCall ||
                    candidate.vFunctionCallType !== ExternalReferenceType.UserDefined)
            ) {
                continue;
            }

            const decl =
                candidate instanceof FunctionCall
                    ? candidate.vReferencedDeclaration
                    : candidate.vModifier;

            assert(decl !== undefined, "Should have a decl since builtins are skipped");

            // Compute formal VariableDeclarations
            let formals: VariableDeclaration[];

            if (
                decl instanceof FunctionDefinition ||
                decl instanceof EventDefinition ||
                decl instanceof ErrorDefinition ||
                decl instanceof ModifierDefinition
            ) {
                // Function-like definitions (functions, events, errors, modifiers) just get the declaraed parameters
                formals = decl.vParameters.vParameters;
            } else if (decl instanceof VariableDeclaration) {
                // For variable definitions we have 2 cases - either its a public state var or a function pointer variable
                if (decl.stateVariable) {
                    // This case is tricky, as there are no formal parameters in the AST to yield. (the getter is implicitly generated)
                    // Luckily, these implicit assignments don't allow aliasing (as they are external calls).
                    // Furthermore these use sites don't need special instrumentation.
                    // So we allow imprecision here and skip these
                    continue;
                } else {
                    assert(
                        decl.vType instanceof FunctionTypeName,
                        "Unexpected callee variable without function type",
                        decl.vType
                    );

                    // The result in this case is not also quite correct. From a dataflow perspective
                    // correct overapproximation would be to should consider
                    // assignments to the formal parameters of all declared functions that match
                    // the variable signature. For scribble's use case (detecting potential aliasing of state vars) this
                    // code is sufficient.
                    formals = decl.vType.vParameterTypes.vParameters;
                }
            } else if (decl.vConstructor) {
                formals = decl.vConstructor.vParameters.vParameters;
            } else {
                // Implicit constructor - no arguments
                formals = [];
            }

            const actuals = [...candidate.vArguments];

            // When we have a library method or free function
            // bound with `using lib for ...`,
            // there is a need to add the implicit first argument.
            // To check that the call is due to a `using for` we check that
            // 1) The call expression is a member access
            // 2) The referenced functions is a library function or a free function
            // 3) The referenced function has 1 more formal argument than the provided actuals
            if (
                candidate instanceof FunctionCall &&
                candidate.vExpression instanceof MemberAccess &&
                decl instanceof FunctionDefinition &&
                ((decl.parent instanceof ContractDefinition &&
                    decl.parent.kind === ContractKind.Library) ||
                    decl.kind === FunctionKind.Free) &&
                formals.length === candidate.vArguments.length + 1
            ) {
                actuals.unshift(candidate.vExpression.vExpression);
            }

            yield* helper(formals, actuals);
        } else if (candidate instanceof Return) {
            const formals = candidate.vFunctionReturnParameters.vParameters;
            const rhs = candidate.vExpression;

            if (rhs === undefined) {
                // @note (dimo) skipping implicit 0-assignment of return vars
                continue;
            }

            yield* helper(formals, rhs);
        } else if (candidate instanceof VariableDeclaration) {
            // Handle iniline initializers for state variables and file-level constants
            if (
                (candidate.stateVariable || candidate.parent instanceof SourceUnit) &&
                candidate.vValue !== undefined
            ) {
                yield [candidate, candidate.vValue];
            }
        } else if (candidate instanceof InheritanceSpecifier) {
            const contract = candidate.vBaseType.vReferencedDeclaration;

            assert(
                contract instanceof ContractDefinition,
                "Unexpected base in inheritance specifier",
                contract
            );

            const formals = contract.vConstructor
                ? contract.vConstructor.vParameters.vParameters
                : [];

            // If there is both an InheritanceSpecifier and a ModifierInvocation at the constructor,
            // we want to skip the InheritanceSpecifier.
            if (formals.length !== 0 && candidate.vArguments.length === 0) {
                continue;
            }

            yield* helper(formals, candidate.vArguments);
        } else {
            assert(false, "NYI assignment candidate", candidate);
        }
    }
}

/**
 * Return true IFF the type `t` is aliasable by a storage pointer.
 */
export function isTypeAliasable(t: TypeName): boolean {
    return (
        t instanceof ArrayTypeName ||
        t instanceof Mapping ||
        (t instanceof UserDefinedTypeName &&
            t.vReferencedDeclaration instanceof StructDefinition) ||
        (t instanceof ElementaryTypeName && (t.name === "string" || t.name === "bytes"))
    );
}

/**
 * Find all state vars that have been assigned (or an aliasable part of them assigned) to
 * a storage pointer on the stack.
 *
 * @todo (dimo) This code is hacky. To do this cleanly we need proper dataflow analysis.
 * Its tricky to implement dataflow analysis over an AST.
 *
 * Returns a map from variable declarations to ASTNodes, where the node is a possible aliasing
 * assignment for that state var
 */
export function findAliasedStateVars(units: SourceUnit[]): Map<VariableDeclaration, ASTNode> {
    const assignments: Array<[LHS, RHS]> = [];
    const res = new Map<VariableDeclaration, ASTNode>();

    // First collect all assignments
    for (const unit of units) {
        assignments.push(...getAssignments(unit));
    }

    /**
     * Given a potentially complex RHS expression, return the list of
     * state variable declarations that it may alias
     */
    const gatherRHSVars = (rhs: Expression): VariableDeclaration[] => {
        if (isStateVarRef(rhs)) {
            return [rhs.vReferencedDeclaration as VariableDeclaration];
        }

        if (rhs instanceof Identifier) {
            return [];
        }

        if (rhs instanceof MemberAccess) {
            return gatherRHSVars(rhs.vExpression);
        }

        if (rhs instanceof IndexAccess) {
            return gatherRHSVars(rhs.vBaseExpression);
        }

        if (rhs instanceof FunctionCall) {
            if (rhs.kind === FunctionCallKind.TypeConversion) {
                return gatherRHSVars(single(rhs.vArguments));
            } else {
                // If the rhs is the result of a function call. no need to
                // do anything - we will catch any aliasing inside the
                // callee
                return [];
            }
        }

        if (rhs instanceof Conditional) {
            const trueVars = gatherRHSVars(rhs.vTrueExpression);
            const falseVars = gatherRHSVars(rhs.vFalseExpression);

            return trueVars.concat(falseVars);
        }

        if (rhs instanceof TupleExpression && rhs.vOriginalComponents.length === 1) {
            return gatherRHSVars(rhs.vOriginalComponents[0] as Expression);
        }

        assert(false, `Unexpected RHS element ${print(rhs)} in assignment to state var pointer`);
    };

    for (const [lhs, rhs] of assignments) {
        // Storage pointers can't be nested in
        // structs or arrays so the LHS can't be a `MemberAccess` or
        // `IndexAccess`.
        if (!(lhs instanceof Identifier || lhs instanceof VariableDeclaration)) {
            continue;
        }

        const lhsDecl = lhs instanceof VariableDeclaration ? lhs : lhs.vReferencedDeclaration;

        // If LHS is a VariableDeclaration make sure its for a local variable or a function call/return value
        if (
            !(
                lhsDecl instanceof VariableDeclaration &&
                (lhsDecl.parent instanceof VariableDeclarationStatement ||
                    (lhsDecl.parent instanceof ParameterList &&
                        (lhsDecl.parent.parent instanceof FunctionDefinition ||
                            lhsDecl.parent.parent instanceof ModifierDefinition)))
            )
        ) {
            continue;
        }

        // Dont support old-style `var`s (<0.5.0)
        assert(lhsDecl.vType !== undefined, "Missing type for declaration", lhsDecl);

        // Check that the LHS is a pointer to storage
        if (!(isTypeAliasable(lhsDecl.vType) && lhsDecl.storageLocation === DataLocation.Storage)) {
            continue;
        }

        // If the rhs is an [Expression, number] then its the result of a function call.
        // No need to do anything - we will catch any aliasing inside the callee
        if (rhs instanceof Array) {
            continue;
        }

        const varDecls = gatherRHSVars(rhs);

        for (const decl of varDecls) {
            const lhsNode = lhs instanceof Array ? lhs[0] : lhs;

            res.set(decl, lhsNode);
        }
    }

    return res;
}

/**
 * Describes the sequence of IndexAccesses and MemberAccesses on a given
 * expression.
 */
export type ConcreteDatastructurePath = Array<Expression | string>;
export type StateVarUpdateNode =
    | [Assignment, number[]]
    | VariableDeclaration
    | FunctionCall
    | UnaryOperation;
/**
 * Tuple describing a location in the AST where a SINGLE state variable is modified. Has the following
 * 4 fields:
 *
 *  1) `ASTNode` containing the update. It can be one of the following:
 *    - `[Assignment, number[]]` - an assignment. The LHS can potentiall be a
 *      tuple, in which case the second tuple argument describes the location in the
 *      tuple where the state var reference is (see statevars.spec.ts for examples)
 *    - `VariableDeclaration` - corresponds to an inline initializer at the state var definition site.
 *    - `FunctionCall` - corresponds to `.push(..)` and `.pop()` calls on arrays
 *    - `UnaryOperation` - corresponds to a `delete ...`, `++` or `--` operation
 *  2) The `VariableDeclaration` of the state var that is being modified.
 *  3) A `ConcreteDatastructurePath` describing what part of the state var is being modified. (see statevars.spec.ts for examples)
 *  4) The new value that is being assigned to the state variable/part of the state variable. It can be 3 different types:
 *    - `Expression` - an AST expression that is being directly assigned
 *    - `[Expression, number]` - corresponds to the case where we have an assignment of the form `(x,y,z) = func()`. Describes which
 *      return of the function is being assigned
 *    - undefined - in the cases where we do `.push(..)`, `.pop()`, `delete ...`,
 *    `x++`, `x--` we don't quite have a new value being assigned, so we leave
 *    this undefined.
 *  5) The type of the new value (of any). Otherwise undefined
 */
export type StateVarUpdateDesc = [
    StateVarUpdateNode,
    VariableDeclaration,
    ConcreteDatastructurePath,
    Expression | [Expression, number] | undefined,
    TypeNode | undefined
];

export function stateVarUpdateValToType(
    infer: InferType,
    newVal: Expression | [Expression, number] | undefined
): TypeNode | undefined {
    if (newVal instanceof Expression) {
        return infer.typeOf(newVal);
    }

    if (newVal instanceof Array) {
        const tupleT = infer.typeOf(newVal[0]);

        assert(tupleT instanceof TupleType, `Expectd tuple type not {0} in {1}`, tupleT, newVal[0]);

        const elementT = tupleT.elements[newVal[1]];

        assert(
            elementT !== null,
            "Unexpected empty tuple element for state var update, {0}",
            newVal
        );

        return elementT;
    }

    return undefined;
}

export type LHSRoot = Identifier | MemberAccess | FunctionCall;

/**
 * Given a LHS expression that may be wrapped in `MemberAccess` and
 * `IndexAccess`-es, unwrap it into a base expression that is either an
 * `Identifier` or a `MemberAccess` that refers to a local var, argument,
 * return or state variable and a list describing the `MemberAccess`-es and
 * `IndexAccess`-es.
 *
 * @note there is one exception here: `arr.push() = 10`. But honestly screw it.
 */
export function decomposeLHS(e: Expression): [LHSRoot, ConcreteDatastructurePath] {
    const path: ConcreteDatastructurePath = [];
    const originalExp = e;

    while (true) {
        if (
            e instanceof MemberAccess &&
            !(
                e.vReferencedDeclaration instanceof VariableDeclaration &&
                !(e.vReferencedDeclaration.parent instanceof StructDefinition)
            )
        ) {
            path.unshift(e.memberName);

            e = e.vExpression;

            continue;
        }

        if (e instanceof IndexAccess) {
            assert(e.vIndexExpression !== undefined, "Expected index expression to be defined", e);

            path.unshift(e.vIndexExpression);

            e = e.vBaseExpression;

            continue;
        }

        if (e instanceof TupleExpression && e.vOriginalComponents.length === 1) {
            e = e.vOriginalComponents[0] as Expression;

            continue;
        }

        if (
            e instanceof FunctionCall &&
            e.vFunctionName === "get_lhs" &&
            e.vReferencedDeclaration instanceof FunctionDefinition &&
            e.vReferencedDeclaration.vScope instanceof ContractDefinition &&
            e.vReferencedDeclaration.vScope.kind === ContractKind.Library
        ) {
            assert(e.vArguments.length === 2, "Unexpected args for get_lhs: {0}", e.vArguments);

            path.unshift(e.vArguments[1]);

            e = e.vArguments[0];

            continue;
        }

        break;
    }

    if (e instanceof FunctionCall && e.vFunctionName === "push") {
        throw new Error(
            `Scribble doesn't support instrumenting assignments where the LHS is a push(). Problematic LHS: ${print(
                originalExp
            )}`
        );
    }

    if (e instanceof Assignment) {
        throw new Error(
            `Scribble doesn't support instrumenting assignments where the LHS is an assignment itself. Problematic LHS: ${print(
                originalExp
            )}`
        );
    }

    assert(
        e instanceof Identifier || e instanceof MemberAccess || e instanceof FunctionCall,
        "Unexpected LHS",
        e
    );

    return [e, path];
}

/**
 * Return true IFF `node` refers to same state variable
 */
export function isStateVarRef(node: ASTNode): node is Identifier | MemberAccess {
    return (
        (node instanceof Identifier || node instanceof MemberAccess) &&
        node.vReferencedDeclaration instanceof VariableDeclaration &&
        node.vReferencedDeclaration.stateVariable
    );
}

/**
 * Given a context `ctx` and the left-hand side of an assignment pair `lhs` (as
 * returned from `getAssignments`), return true IFF the original assignment from
 * which `lhs` comes is an call to a custom map library setter function. I.e.
 * this was an assignment that was instrumented due to a `forall` annotation.
 */
function isAssignmentCustomMapSet(ctx: InstrumentationContext, lhs: LHS): boolean {
    if (
        !(
            lhs instanceof VariableDeclaration &&
            lhs.vScope instanceof FunctionDefinition &&
            lhs.vScope.name === "set" &&
            lhs === lhs.vScope.vParameters.vParameters[0]
        )
    ) {
        return false;
    }

    const contract = lhs.vScope.vScope;

    return (
        contract instanceof ContractDefinition && ctx.typesToLibraryMap.isCustomMapLibrary(contract)
    );
}

/**
 * Given a set of units, find all locations in the AST where state variables are updated directly.
 * (NOTE: This doesn't find locations where state variables are updated through pointers!!)
 *
 * Returns a list of locations descriptions tuples `[node, variable, path, newValue]`. Given the following example:
 *
 *  ```
 *     struct Point {
 *          uint x;
 *          uint y;
 *     }
 *
 *     Point[] points;
 *     ...
 *          points[0].x = 1;
 * ```
 *
 * We would get `[points[0].x = 1, Point[] points, [0, "x"],  1]`.
 * Below are the definitions of the tuple elements:
 *
 *  - `node` is the ASTNode where the update happens. In the above example its the assignment `point[0].x = 1;`
 *  - `variable` is the `VariableDeclaration` for the modified variable. In the above example its the def `Point[] points`
 *  - `path` is an description of what part of a complex state var is changed. In the above example its `[0, "x"]`. Expression
 *     elements of the array refer to indexing, and string elements refer to field lookups in structs.
 *  - `newValue` is the new expression that is being assigned. In the above example its `1`.
 */
export function findStateVarUpdates(
    units: SourceUnit[],
    ctx: InstrumentationContext
): StateVarUpdateDesc[] {
    const res: StateVarUpdateDesc[] = [];
    const infer = ctx.typeEnv.inference;

    /**
     * Given some `lhs` expression, return the containing `Assignment`, and build the tuple path
     * from the `Assignment` to `lhs`.
     */
    const getLHSAssignmentAndPath = (lhs: Expression): [Assignment, number[]] => {
        const idxPath: number[] = [];

        while (lhs.parent instanceof TupleExpression) {
            const idx = lhs.parent.vOriginalComponents.indexOf(lhs);

            assert(
                idx !== -1,
                "Unable to detect LHS index in tuple expression components",
                lhs,
                lhs.parent
            );

            idxPath.unshift(idx);

            lhs = lhs.parent;
        }

        const assignment = lhs.parent as ASTNode;

        assert(assignment instanceof Assignment, "Expected assignment, got {0}", assignment);

        return [assignment, idxPath];
    };

    /**
     * Helper to skip assignment locations where the LHS is not a state variable ref
     */
    const addStateVarUpdateLocDesc = (
        node: [Assignment, number[]] | FunctionCall | UnaryOperation,
        lhs: Expression,
        rhs: Expression | [Expression, number] | undefined
    ): void => {
        const [baseExp, path] = decomposeLHS(lhs);

        // Skip assignments where the base of the LHS is not a direct reference to a state variable
        if (!isStateVarRef(baseExp)) {
            return;
        }

        const stateVarDecl = baseExp.vReferencedDeclaration as VariableDeclaration;

        res.push([node, stateVarDecl, path, rhs, stateVarUpdateValToType(infer, rhs)]);
    };

    for (const unit of units) {
        // First find all updates due to assignments
        for (const [lhs, rhs] of getAssignments(unit)) {
            // Assignments to struct constructor fields - ignore
            if (lhs instanceof Array) {
                continue;
            }

            if (isAssignmentCustomMapSet(ctx, lhs)) {
                assert(
                    rhs instanceof Expression,
                    "Cannot have a tuple as second argument to library.set()"
                );

                const funCall = rhs.parent;

                assert(
                    funCall instanceof FunctionCall &&
                        funCall.vFunctionName === "set" &&
                        funCall.vArguments.length === 3 &&
                        rhs === funCall.vArguments[0],
                    "RHS parent must be a call to library.set() not {0}",
                    funCall
                );

                const [baseExp, path] = decomposeLHS(funCall.vArguments[0]);

                // Skip assignments where the base of the LHS is not a direct reference to a state variable
                if (!isStateVarRef(baseExp)) {
                    continue;
                }

                path.push(funCall.vArguments[1]);

                const stateVarDecl = baseExp.vReferencedDeclaration as VariableDeclaration;

                const newVal = funCall.vArguments[2];
                const typ = infer.typeOf(newVal);

                res.push([funCall, stateVarDecl, path, newVal, typ]);

                continue;
            }

            if (lhs instanceof VariableDeclaration) {
                // Local variable/function arg/function return - skip
                if (!lhs.stateVariable) {
                    continue;
                }

                assert(
                    rhs instanceof Expression,
                    `RHS cannot be a tuple/function with multiple returns.`
                );

                // State variable inline initializer
                res.push([lhs, lhs, [], rhs, infer.typeOf(rhs)]);

                continue;
            }

            addStateVarUpdateLocDesc(getLHSAssignmentAndPath(lhs), lhs, rhs);
        }

        // Find all state var updates due to .push() and pop() calls
        for (const candidate of unit.getChildrenBySelector<FunctionCall>(
            (node) =>
                node instanceof FunctionCall &&
                node.vFunctionCallType === ExternalReferenceType.Builtin &&
                (node.vFunctionName === "push" || node.vFunctionName === "pop")
        )) {
            addStateVarUpdateLocDesc(
                candidate,
                (candidate.vExpression as MemberAccess).vExpression,
                undefined
            );
        }

        // Find all state var updates due to unary operations (delete, ++, --)
        for (const candidate of unit.getChildrenBySelector<UnaryOperation>(
            (node) =>
                node instanceof UnaryOperation &&
                (node.operator === "delete" || node.operator === "++" || node.operator === "--")
        )) {
            addStateVarUpdateLocDesc(candidate, candidate.vSubExpression, undefined);
        }
    }

    return res;
}
