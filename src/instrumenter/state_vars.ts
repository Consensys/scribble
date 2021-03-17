import {
    ArrayTypeName,
    Assignment,
    ASTNode,
    ContractDefinition,
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
    UserDefinedTypeName,
    VariableDeclaration,
    VariableDeclarationStatement
} from "solc-typed-ast";
import { assert, pp, single, zip } from "..";

export type LHS = Expression | VariableDeclaration | [Expression, string];
export type RHS = Expression | [Expression, number];

/**
 * Given potentially complex assignments involving tuples and function return desugaring, return an
 * iterable of all the primitive assignments happening between. (i.e. assignments where the LHS is not a tuple)
 *
 * @param lhs
 * @param rhs
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

                for (const [subLhs, subRhs] of getAssignmentComponents(lhsComp, rhsComp)) {
                    yield [subLhs, subRhs];
                }
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
 * @param node
 */
export function* getAssignments(node: ASTNode): Iterable<[LHS, RHS]> {
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
            for (const [lhs, rhs] of getAssignmentComponents(
                candidate.vLeftHandSide,
                candidate.vRightHandSide
            )) {
                yield [lhs, rhs];
            }
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
                assert(
                    candidate.fieldNames !== undefined &&
                        candidate.fieldNames.length === candidate.vArguments.length,
                    ``
                );

                for (let i = 0; i < candidate.fieldNames.length; i++) {
                    yield [[candidate, candidate.fieldNames[i]], candidate.vArguments[i]];
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

            yield* helper(formals, candidate.vArguments);
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
 * @param t
 */
function isTypeAliasable(t: TypeName): boolean {
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
 * @param units
 */
export function findAliasedStateVars(units: SourceUnit[]): Set<VariableDeclaration> {
    const assignments: Array<[LHS, RHS]> = [];
    const res: Set<VariableDeclaration> = new Set();

    // First collect all assignments
    for (const unit of units) {
        assignments.push(...getAssignments(unit));
    }

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

        let exp: Expression | undefined = rhs;

        // The RHS is a squecne of MemberAccess/IndexAccess that has a reference
        // to a state variable at the base. The reference to the state variable is either
        // an Identifier or a MemberAccess of the shape `ContractName.StateVarName`
        while (
            exp !== undefined &&
            !(
                exp instanceof Identifier ||
                (exp instanceof MemberAccess &&
                    exp.vReferencedDeclaration instanceof VariableDeclaration &&
                    exp.vReferencedDeclaration.stateVariable)
            )
        ) {
            if (exp instanceof MemberAccess) {
                exp = exp.vExpression;
            } else if (exp instanceof IndexAccess) {
                exp = exp.vBaseExpression;
            } else if (exp instanceof FunctionCall) {
                if (exp.kind === FunctionCallKind.TypeConversion) {
                    exp = single(exp.vArguments);
                } else {
                    // If the rhs is the result of a function call. no need to
                    // do anything - we will catch any aliasing inside the
                    // callee
                    exp = undefined;
                }
            } else {
                throw new Error(
                    `Unexpected RHS element ${pp(rhs)} in assignment ${pp(rhs)} -> ${pp(lhs)}`
                );
            }
        }

        if (exp === undefined) {
            continue;
        }

        assert(
            exp.vReferencedDeclaration instanceof VariableDeclaration &&
                exp.vReferencedDeclaration.stateVariable,
            `Unexpected base ${pp(exp)} of rhs in assignment  ${pp(rhs)} -> ${pp(lhs)}`
        );

        res.add(exp.vReferencedDeclaration);
    }

    return res;
}

/**
 * Given a list of state variable declarations `vars` and a list of SourceUnits
 * `units` return only those `VariableDeclaration`s from `vars` that are not
 * aliased (and no sub-component of theirs is alised) by a storage pointer on
 * stack.
 *
 * @param units
 */
export function unaliasedVars(
    vars: VariableDeclaration[],
    units: SourceUnit[]
): VariableDeclaration[] {
    const aliasedDecls = findAliasedStateVars(units);
    return vars.filter((decl) => !aliasedDecls.has(decl));
}
