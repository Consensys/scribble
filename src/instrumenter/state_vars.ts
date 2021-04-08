import {
    ArrayTypeName,
    Assignment,
    ASTNode,
    Conditional,
    ContractDefinition,
    ContractKind,
    DataLocation,
    ElementaryTypeName,
    EventDefinition,
    Expression,
    ExternalReferenceType,
    FunctionCall,
    FunctionCallKind,
    FunctionDefinition,
    Identifier,
    IndexAccess,
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
    TypeName,
    UnaryOperation,
    UserDefinedTypeName,
    VariableDeclaration,
    VariableDeclarationStatement
} from "solc-typed-ast";
import { assert, pp, print, single, zip } from "..";

export type LHS = Expression | VariableDeclaration | [Expression, string];
export type RHS = Expression | [Expression, number];

/**
 * Given potentially complex assignments involving tuples and function return desugaring, return an
 * iterable of all the primitive assignments happening between. (i.e. assignments where the LHS is not a tuple)
 */
function* getAssignmentComponents(lhs: Expression, rhs: Expression): Iterable<[LHS, RHS]> {
    if (lhs instanceof TupleExpression) {
        if (rhs instanceof TupleExpression) {
            assert(lhs.vOriginalComponents.length === rhs.vOriginalComponents.length, ``);
            for (let i = 0; i < lhs.vOriginalComponents.length; i++) {
                const lhsComp = lhs.vOriginalComponents[i];
                const rhsComp = rhs.vOriginalComponents[i];
                // Skip assignments where LHS is omitted
                if (lhsComp === null) {
                    continue;
                }

                assert(rhsComp !== null, `Unexpected null in rhs of ${pp(rhs)} in position ${i}`);

                yield* getAssignmentComponents(lhsComp, rhsComp);
            }
        } else if (rhs instanceof FunctionCall) {
            for (let i = 0; i < lhs.vOriginalComponents.length; i++) {
                const lhsComp = lhs.vOriginalComponents[i];
                // Skip assignments where LHS is omitted
                if (lhsComp === null) {
                    continue;
                }

                yield [lhsComp, [rhs, i]];
            }
        } else {
            throw new Error(`Unexpected rhs in tuple assignment: ${pp(rhs)}`);
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
            assert(actuals.vComponents.length === actuals.vOriginalComponents.length, ``);
            return zip(formals, actuals.vComponents);
        }

        if (actuals instanceof FunctionCall) {
            const callRets: Array<
                [FunctionCall, number]
            > = (actuals.vReferencedDeclaration as FunctionDefinition).vReturnParameters.vParameters.map<
                [FunctionCall, number]
            >((decl, i) => [actuals, i]);
            return zip(formals, callRets);
        }

        throw new Error(`Unexpected rhs ${pp(actuals)} for lhs ${pp(formals)}`);
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

            if (candidate.assignments.length === 1) {
                yield [candidate.vDeclarations[0], rhs];
            } else if (rhs instanceof TupleExpression || rhs instanceof FunctionCall) {
                if (rhs instanceof TupleExpression) {
                    assert(
                        candidate.assignments.length === rhs.vOriginalComponents.length &&
                            rhs.vOriginalComponents.length === rhs.vComponents.length,
                        ``
                    );
                }

                for (let i = 0; i < candidate.assignments.length; i++) {
                    const declId = candidate.assignments[i];

                    if (declId === null) {
                        continue;
                    }

                    const decl = candidate.requiredContext.locate(declId) as VariableDeclaration;
                    if (rhs instanceof TupleExpression) {
                        yield [decl, rhs.vComponents[i]];
                    } else {
                        yield [decl, [rhs, i]];
                    }
                }
            } else {
                throw new Error(
                    `Unexpected rhs ${pp(rhs)} for tuple variable decl statement ${pp(candidate)}`
                );
            }
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
                        : structDecl.vMembers.map((decl) => decl.name);

                assert(fieldNames.length === candidate.vArguments.length, ``);

                for (let i = 0; i < fieldNames.length; i++) {
                    yield [[candidate, fieldNames[i]], candidate.vArguments[i]];
                }
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

            assert(decl !== undefined, `Should have a decl since we skip builtins`);

            // Compute formal VariableDeclarations
            let formals: VariableDeclaration[];

            if (
                decl instanceof FunctionDefinition ||
                decl instanceof EventDefinition ||
                decl instanceof ModifierDefinition
            ) {
                formals = decl.vParameters.vParameters;
            } else {
                if (decl.vConstructor) {
                    formals = decl.vConstructor.vParameters.vParameters;
                } else {
                    // Implicit constructor - no arguments
                    formals = [];
                }
            }

            const actuals = [...candidate.vArguments];

            // When we have a library method bound with `using lib for ...`
            // need to add the implicit first argument
            if (
                candidate instanceof FunctionCall &&
                decl instanceof FunctionDefinition &&
                decl.parent instanceof ContractDefinition &&
                decl.parent.kind === ContractKind.Library &&
                formals.length === candidate.vArguments.length + 1
            ) {
                assert(
                    candidate.vExpression instanceof MemberAccess,
                    `Unexpected callee in library call ${pp(candidate)}`
                );

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
                `Unexpected base in inheritance specifier: ${pp(contract)}`
            );

            const formals = contract.vConstructor
                ? contract.vConstructor.vParameters.vParameters
                : [];

            yield* helper(formals, candidate.vArguments);
        } else {
            throw new Error(`NYI assignment candidate ${pp(candidate)}`);
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

        throw new Error(`Unexpected RHS element ${print(rhs)} in assignment to state var pointer`);
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
        assert(lhsDecl.vType !== undefined, `Missing type for declaration ${pp(lhsDecl)}`);

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
 *
 */
export type StateVarUpdateDesc = [
    StateVarUpdateNode,
    VariableDeclaration,
    ConcreteDatastructurePath,
    Expression | [Expression, number] | undefined
];

/**
 * Given a LHS expression that may be wrapped in `MemberAccess` and
 * `IndexAccess`-es, unwrap it into a base expression that is either an
 * `Identifier` or a `MemberAccess` that refers to a local var, argument,
 * return or state variable and a list describing the `MemberAccess`-es and
 * `IndexAccess`-es.
 *
 * @note there is one exception here: `arr.push() = 10`. But honestly screw it.
 */
export function decomposeLHS(
    e: Expression
): [Identifier | MemberAccess, ConcreteDatastructurePath] {
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
            assert(e.vIndexExpression !== undefined, ``);
            path.unshift(e.vIndexExpression);
            e = e.vBaseExpression;
            continue;
        }

        if (e instanceof TupleExpression && e.vOriginalComponents.length === 1) {
            e = e.vOriginalComponents[0] as Expression;
            continue;
        }

        break;
    }

    if (e instanceof FunctionCall && e.vFunctionName === "push") {
        throw new Error(
            `Scribble doesn't support instrument assignments where the LHS is a push(). Problematic LHS: ${print(
                originalExp
            )}`
        );
    }

    assert(e instanceof Identifier || e instanceof MemberAccess, ``);
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
export function findStateVarUpdates(units: SourceUnit[]): StateVarUpdateDesc[] {
    const res: StateVarUpdateDesc[] = [];

    /**
     * Given some `lhs` expression, return the containing `Assignment`, and build the tuple path
     * from the `Assignment` to `lhs`.
     */
    const getLHSAssignmentAndPath = (lhs: Expression): [Assignment, number[]] => {
        const idxPath: number[] = [];

        while (lhs.parent instanceof TupleExpression) {
            const idx = lhs.parent.vOriginalComponents.indexOf(lhs);
            assert(idx !== -1, ``);
            idxPath.unshift(idx);
            lhs = lhs.parent;
        }

        const assignment = lhs.parent as ASTNode;
        assert(
            assignment instanceof Assignment,
            `Unexpected state var LHS in ${assignment.constructor.name}#${lhs.id} - expected assignment`
        );

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

        const stateVarDecl: VariableDeclaration = baseExp.vReferencedDeclaration as VariableDeclaration;

        res.push([node, stateVarDecl, path, rhs]);
    };

    for (const unit of units) {
        // First find all updates due to assignments
        for (const [lhs, rhs] of getAssignments(unit)) {
            // Assignments to struct constructor fields - ignore
            if (lhs instanceof Array) {
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
                res.push([lhs, lhs, [], rhs]);
                continue;
            }

            addStateVarUpdateLocDesc(getLHSAssignmentAndPath(lhs), lhs, rhs);
        }

        // Find all state var updates due to .push() and pop() calls
        for (const candidate of unit.getChildrenBySelector(
            (node) =>
                node instanceof FunctionCall &&
                node.vFunctionCallType === ExternalReferenceType.Builtin &&
                (node.vFunctionName === "push" || node.vFunctionName === "pop")
        )) {
            const funCall = candidate as FunctionCall;

            addStateVarUpdateLocDesc(
                funCall,
                (funCall.vExpression as MemberAccess).vExpression,
                undefined
            );
        }

        // Find all state var updates due to unary operations (delete, ++, --)
        for (const candidate of unit.getChildrenBySelector(
            (node) =>
                node instanceof UnaryOperation &&
                (node.operator === "delete" || node.operator === "++" || node.operator === "--")
        )) {
            const unop = candidate as UnaryOperation;
            addStateVarUpdateLocDesc(unop, unop.vSubExpression, undefined);
        }
    }

    return res;
}
