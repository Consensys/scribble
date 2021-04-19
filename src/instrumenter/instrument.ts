import {
    Assignment,
    ASTNodeFactory,
    Block,
    ContractDefinition,
    ContractKind,
    DataLocation,
    EventDefinition,
    Expression,
    ExternalReferenceType,
    FunctionCall,
    FunctionCallKind,
    FunctionDefinition,
    FunctionKind,
    FunctionStateMutability,
    FunctionVisibility,
    LiteralKind,
    Mutability,
    OverrideSpecifier,
    resolveByName,
    SourceUnit,
    Statement,
    StateVariableVisibility,
    VariableDeclaration,
    EmitStatement,
    Literal,
    ASTNode,
    UncheckedBlock
} from "solc-typed-ast";
import {
    AddBaseContract,
    AddConstructor,
    cook,
    InsertFunction,
    InsertStatement,
    Recipe,
    InsertEvent
} from "../rewriter";
import {
    Range,
    SBinaryOperation,
    SBooleanLiteral,
    SConditional,
    SFunctionCall,
    SFunctionType,
    SHexLiteral,
    SId,
    SIndexAccess,
    SLet,
    SMemberAccess,
    SNode,
    SNumber,
    SStringLiteral,
    STupleType,
    SType,
    SUnaryOperation,
    SAddressType,
    SBoolType,
    SBytes,
    SFixedBytes,
    SIntType,
    SPointer,
    SString,
    SAddressLiteral,
    SResult,
    SUserFunctionDefinition
} from "../spec-lang/ast";
import { StateVarScope, SemMap, TypeEnv } from "../spec-lang/tc";
import { parse as parseTypeString } from "../spec-lang/typeString_parser";
import {
    assert,
    isChangingState,
    isExternallyVisible,
    parseSrcTriple,
    print,
    single
} from "../util";
import {
    AnnotationMetaData,
    PropertyMetaData,
    UserFunctionDefinitionMetaData,
    PPAbleError,
    rangeToLocRange
} from "./annotations";
import { walk } from "../spec-lang/walk";
import { interpose, interposeCall } from "./interpose";
import { generateExprAST, generateFunVarDecl, generateTypeAst } from "./transpile";
import { dirname, relative } from "path";
import { InstrumentationContext } from "./instrumentation_context";
import { TranspilingContext } from "./transpiling_context";

import { gte } from "semver";

export type SBinding = [string | string[], SType, SNode, boolean];
export type SBindings = SBinding[];

export class InstrumentationError extends PPAbleError {}
/**
 * Base class for all type errors due to some valid Solidity feature that
 * we do not yet support
 */
export class UnsupportedConstruct extends InstrumentationError {
    public readonly unsupportedNode: ASTNode;
    public readonly unit: SourceUnit;

    constructor(msg: string, unsupportedNode: ASTNode, files: Map<string, string>) {
        const unit = unsupportedNode.getClosestParentByType(SourceUnit);
        assert(unit !== undefined, `No unit for node ${print(unsupportedNode)}`);
        const contents = files.get(unit.sourceEntryKey);
        assert(contents !== undefined, `Missing contents for ${unit.sourceEntryKey}`);

        const unitLoc = parseSrcTriple(unsupportedNode.src);
        const range = rangeToLocRange(unitLoc[0], unitLoc[1], contents);

        super(msg, range);

        this.unsupportedNode = unsupportedNode;
        this.unit = unit;
    }
}

export interface InstrumentationResult {
    oldAssignments: Assignment[];
    newAssignments: Assignment[];
    transpiledPredicates: Expression[];
    debugEventsInfo: Array<[EventDefinition, EmitStatement] | undefined>;
}

export type SubclassConstructor<Base, Child extends Base> = new (...args: any[]) => Child;
function filterByType<Base, Child extends Base>(
    original: Base[],
    constr: SubclassConstructor<Base, Child>
): Child[] {
    const result: Child[] = [];
    for (const annotation of original) {
        if (annotation instanceof constr) {
            result.push(annotation);
        }
    }

    return result;
}

/// Return true if the current instrumentation configuration requires
/// instrumented pure/view functions to become non-payable
export function changesMutability(ctx: InstrumentationContext): boolean {
    return ctx.assertionMode === "log";
}

export function findExternalCalls(node: ContractDefinition | FunctionDefinition): FunctionCall[] {
    const res: FunctionCall[] = [];

    for (const call of node.getChildrenByType(FunctionCall)) {
        if (call.kind !== FunctionCallKind.FunctionCall) {
            continue;
        }

        if (call.vFunctionCallType === ExternalReferenceType.Builtin) {
            // For builtin calls check if its one of:
            // (address).{call, delegatecall, staticcall}
            if (!["call", "delegatecall", "staticcall"].includes(call.vFunctionName)) {
                continue;
            }
        } else {
            // For normal contract calls check if the type of the callee is an external function
            const calleeType = parseTypeString(call.vExpression.typeString);

            assert(
                calleeType instanceof SFunctionType,
                `Expected function type not ${calleeType.pp()} for calee in ${call.print()}`
            );

            if (calleeType.visibility !== FunctionVisibility.External) {
                continue;
            }
        }

        res.push(call);
    }

    return res;
}

export function generateUtilsContract(
    factory: ASTNodeFactory,
    sourceEntryKey: string,
    path: string,
    version: string,
    ctx: InstrumentationContext
): SourceUnit {
    const exportedSymbols = new Map();
    const sourceUnit = factory.makeSourceUnit(sourceEntryKey, -1, path, exportedSymbols);
    sourceUnit.appendChild(factory.makePragmaDirective(["solidity", version]));

    const contract = factory.makeContractDefinition(
        ctx.utilsContractName,
        sourceUnit.id,
        ContractKind.Contract,
        false,
        true,
        [],
        `Utility contract holding a stack counter`
    );

    sourceUnit.appendChild(contract);

    const flag = factory.makeVariableDeclaration(
        false,
        false,
        ctx.outOfContractFlagName,
        contract.id,
        true,
        DataLocation.Default,
        StateVariableVisibility.Default,
        Mutability.Mutable,
        "uint256",
        undefined,
        factory.makeElementaryTypeName("<missing>", "bool"),
        undefined,
        factory.makeLiteral("bool", LiteralKind.Bool, "", "true")
    );

    ctx.addGeneralInstrumentation(flag);

    contract.appendChild(flag);

    ctx.utilsContract = contract;

    return sourceUnit;
}

function gatherDebugIds(n: SNode, typeEnv: TypeEnv): Set<SId> {
    const debugIds: Map<string, SId> = new Map();
    const selectId = (id: SId): void => {
        // Only want let-bindings and variable identifiers
        if (!(id.defSite instanceof Array || id.defSite instanceof VariableDeclaration)) {
            return;
        }

        let key: string;

        if (id.defSite instanceof VariableDeclaration) {
            key = `${id.defSite.id}`;
        } else {
            const t = id.defSite[0];
            if (t instanceof StateVarScope) {
                throw new Error(
                    `Scribble doesn't yet support --debug-events in the presence of instrumented state vars: ${
                        (t.target.vScope as ContractDefinition).name
                    }.${t.target.name}`
                );
            }
            key = `${t.id}_${id.defSite[1]}`;
        }

        if (debugIds.has(key)) {
            return;
        }

        const type = typeEnv.typeOf(id);

        // Only want primitive types and bytes/string
        if (
            !(
                type instanceof SAddressType ||
                type instanceof SBoolType ||
                type instanceof SFixedBytes ||
                type instanceof SIntType ||
                (type instanceof SPointer &&
                    (type.to instanceof SString || type.to instanceof SBytes))
            )
        ) {
            return;
        }

        debugIds.set(key, id);
    };
    walk(n, {
        id: (id: SId) => selectId(id),
        let: (letN: SLet) => letN.lhs.forEach(selectId)
    });

    return new Set(debugIds.values());
}

function registerNode(newN: SNode, oldN: SNode, typeEnv: TypeEnv): SNode {
    if (typeEnv.hasType(oldN)) {
        typeEnv.define(newN, typeEnv.typeOf(oldN));
    }
    return newN;
}

/**
 * Given a typed specification expression `expr` flatten `expr`
 * into an equivalent expression in which each `let-` binding and `old()`
 * is substituted with a new identifier.
 *
 * Additionally return a list of the new identifiers,
 * along with their corresponding type, expression
 * and whether they should be computed in the `old` state.
 *
 * @param expr - specification expression
 * @param typing - type map including typings for all subexpressions in `expr`
 */
export function flattenExpr(expr: SNode, ctx: TranspilingContext): [SNode, SBindings] {
    /**
     * Register the new flattened node `newN`, which corresponds to an old unflattened node `oldN` in the typing map.
     * If `oldN` has a type in `typing` assign the same type to `newN`.
     *
     * @param newN {SNode} - new node
     * @param oldN {SNode} - corresponding old node
     */
    const _registerNode = (newN: SNode, oldN: SNode): SNode => {
        return registerNode(newN, oldN, ctx.typeEnv);
    };

    const getTmpVar = (name: string, oldN: SNode, src?: Range) => {
        const id = ctx.getBindingVarSId();
        return _registerNode(new SMemberAccess(id, name, src), oldN);
    };

    if (expr instanceof SId) {
        // Case when the id is a let variable (e.g. `x` in `let x := 1 in x` or `y` in `let y, z := foo() in y+z`)
        if (expr.defSite instanceof Array) {
            const [defNode, idx] = expr.defSite;

            if (defNode instanceof SLet) {
                const field = ctx.getLetBinding([defNode, idx]);
                return [getTmpVar(field, expr, expr.src), []];
            }

            if (defNode instanceof SUserFunctionDefinition) {
                const renamedId = new SId(ctx.getUserFunArg(defNode, idx), expr.src);
                renamedId.defSite = expr.defSite;
                return [_registerNode(renamedId, expr), []];
            }

            if (defNode instanceof StateVarScope) {
                return [expr, []];
            }

            throw new Error(`Unknown array def site`);
        }

        return [expr, []];
    }

    if (
        expr instanceof SNumber ||
        expr instanceof SBooleanLiteral ||
        expr instanceof SStringLiteral ||
        expr instanceof SHexLiteral ||
        expr instanceof SAddressLiteral ||
        expr instanceof SResult
    ) {
        return [expr, []];
    }

    if (expr instanceof SIndexAccess) {
        const [flatBase, baseBindings] = flattenExpr(expr.base, ctx);
        const [flatIndex, indexBindings] = flattenExpr(expr.index, ctx);

        return [
            _registerNode(new SIndexAccess(flatBase, flatIndex, expr.src), expr),
            baseBindings.concat(indexBindings)
        ];
    }

    if (expr instanceof SMemberAccess) {
        const [flatBase, baseBindings] = flattenExpr(expr.base, ctx);
        const flattenedExpr = new SMemberAccess(flatBase, expr.member, expr.src);

        return [_registerNode(flattenedExpr, expr), baseBindings];
    }

    if (expr instanceof SUnaryOperation) {
        const [flatSubexp, subexpBindings] = flattenExpr(expr.subexp, ctx);

        if (expr.op === "old") {
            const tmpName = ctx.getOldVar(expr);
            const tmpType = ctx.typeEnv.typeOf(expr);

            subexpBindings.push([tmpName, tmpType, flatSubexp, true]);

            return [getTmpVar(tmpName, expr, expr.src), subexpBindings];
        }

        return [
            _registerNode(new SUnaryOperation(expr.op, flatSubexp, expr.src), expr),
            subexpBindings
        ];
    }

    if (expr instanceof SBinaryOperation) {
        const [flatLeft, leftBindings] = flattenExpr(expr.left, ctx);
        const [flatRight, rightBindings] = flattenExpr(expr.right, ctx);

        return [
            _registerNode(new SBinaryOperation(flatLeft, expr.op, flatRight, expr.src), expr),
            leftBindings.concat(rightBindings)
        ];
    }

    if (expr instanceof SConditional) {
        const [flatCond, condBindings] = flattenExpr(expr.condition, ctx);
        const [flatTrue, trueBindings] = flattenExpr(expr.trueExp, ctx);
        const [flatFalse, falseBindings] = flattenExpr(expr.falseExp, ctx);

        return [
            _registerNode(new SConditional(flatCond, flatTrue, flatFalse, expr.src), expr),
            condBindings.concat(trueBindings).concat(falseBindings)
        ];
    }

    if (expr instanceof SFunctionCall) {
        const [flatCallee, calleeBindings] = flattenExpr(expr.callee, ctx);
        const flatArgs: SNode[] = [];
        const argBindings: SBindings[] = [];

        expr.args.forEach((arg: SNode) => {
            const [flatArg, argBinding] = flattenExpr(arg, ctx);

            flatArgs.push(flatArg);

            argBindings.push(argBinding);
        });

        return [
            _registerNode(new SFunctionCall(flatCallee, flatArgs, expr.src), expr),
            argBindings.reduce((acc, cur) => acc.concat(cur), calleeBindings)
        ];
    }

    if (expr instanceof SLet) {
        const rhsT = ctx.typeEnv.typeOf(expr.rhs);
        // Hack to support old(fun()) where fun returns multiple types. Should be
        // removed when we get propper tuples support.
        let flatRHS: SNode;
        let rhsBindings: SBindings;

        if (
            rhsT instanceof STupleType &&
            expr.rhs instanceof SUnaryOperation &&
            expr.rhs.op === "old"
        ) {
            [flatRHS, rhsBindings] = flattenExpr(expr.rhs.subexp, ctx);
        } else {
            [flatRHS, rhsBindings] = flattenExpr(expr.rhs, ctx);
        }

        let bindings: SBindings;
        const rhsSemInfo = ctx.semInfo.get(expr.rhs);
        assert(rhsSemInfo !== undefined, `Missing sem info for let rhs-expr in ${expr.pp()}`);

        if (rhsT instanceof STupleType) {
            if (flatRHS instanceof SResult) {
                assert(
                    ctx.container instanceof FunctionDefinition,
                    `$result only defined on function annotations.`
                );

                assert(
                    expr.lhs.length === ctx.container.vReturnParameters.vParameters.length &&
                        expr.lhs.length === rhsT.elements.length,
                    `Internal error: mismatch between let lhs and righ-hand side $result`
                );

                bindings = [];
                for (let i = 0; i < expr.lhs.length; i++) {
                    const rhs = new SId(ctx.container.vReturnParameters.vParameters[i].name);
                    rhs.defSite = ctx.container.vReturnParameters.vParameters[i];
                    bindings.push([
                        ctx.getLetBinding([expr, i]),
                        rhsT.elements[i],
                        rhs,
                        rhsSemInfo.isOld
                    ]);
                }
            } else {
                bindings = [
                    [
                        expr.lhs.map((id, idx) => ctx.getLetBinding([expr, idx])),
                        rhsT,
                        flatRHS,
                        rhsSemInfo.isOld
                    ]
                ];
            }
        } else {
            bindings = [[ctx.getLetBinding([expr, 0]), rhsT, flatRHS, rhsSemInfo.isOld]];
        }

        const [flatIn, inBindings] = flattenExpr(expr.in, ctx);

        const letBindings = rhsBindings.concat(bindings).concat(inBindings);
        const tmpName = ctx.getLetVar(expr);
        const tmpType = ctx.typeEnv.typeOf(expr);

        const inSemInfo = ctx.semInfo.get(expr.in);
        assert(inSemInfo !== undefined, `Missing sem info for let in-expr in ${expr.pp()}`);
        letBindings.push([tmpName, tmpType, flatIn, inSemInfo.isOld]);

        return [getTmpVar(tmpName, expr, expr.src), letBindings];
    }

    if (expr instanceof SType) {
        return [expr, []];
    }

    if (expr instanceof SResult) {
        return [expr, []];
    }

    throw new Error(`NYI transpiling node ${expr.pp()} of type ${expr.constructor.name}`);
}

/**
 * Generate all the neccessary AST nodes to evaluate a given list of spec expressions.
 *
 * @param exprs - specification expression to evaluate
 * @param typing - type map
 * @param factory - factory for building AST nodes
 * @param loc - context where the expression is to be evaluated. Either a contract, or a particular function inside a contract.
 */
export function generateExpressions(
    annotations: PropertyMetaData[],
    transCtx: TranspilingContext
): InstrumentationResult {
    // Step 1: Define struct holding all the temporary variables neccessary
    const exprs = annotations.map((annot) => annot.expression);
    const instrCtx = transCtx.instrCtx;
    const factory = instrCtx.factory;
    const fn = transCtx.container;
    const contract = fn.vScope;
    assert(contract instanceof ContractDefinition, `Instrumentation doesn't go in free functions`);

    if (instrCtx.assertionMode === "mstore") {
        transCtx.addBinding(
            instrCtx.scratchField,
            factory.makeElementaryTypeName("<missing>", "uint256")
        );
    }

    // Step 2: Flatten all predicates, turning let-bindings and old-keywords to temporary variables
    const flatExprs: SNode[] = [];
    const bindings: SBindings = [];
    const bindingToAnnotations = new Map<number, PropertyMetaData>();

    for (let i = 0; i < exprs.length; i++) {
        const expr = exprs[i];
        const [flatExpr, oneBindings] = flattenExpr(expr, transCtx);

        flatExprs.push(flatExpr);

        // Remember to which annotation these bindings belong to
        for (let j = 0; j < oneBindings.length; j++) {
            bindingToAnnotations.set(bindings.length + j, annotations[i]);
        }

        bindings.push(...oneBindings);
    }

    // Step 2.5: If `--debug-events` is specified compute the debug event for
    // every annotation.
    const debugEventsInfo: Array<[EventDefinition, EmitStatement] | undefined> = [];
    if (instrCtx.debugEvents) {
        for (const annot of annotations) {
            const dbgVars: Array<SId | SMemberAccess> = [];
            // First create the actual expression corresponding to each variable
            // to be traced
            for (const id of gatherDebugIds(annot.expression, transCtx.typeEnv)) {
                const info = transCtx.semInfo.get(id);
                const idType = transCtx.typeEnv.typeOf(id);
                assert(info !== undefined, `Internal: No type or seminfo computed for ${id.pp()}`);

                if (info.isOld && id.defSite instanceof VariableDeclaration) {
                    const tmpName = `dbg_old_${id.name}`;

                    bindingToAnnotations.set(bindings.length, annot);
                    bindings.push([tmpName, idType, id, true]);

                    dbgVars.push(
                        registerNode(
                            new SMemberAccess(transCtx.getBindingVarSId(), tmpName),
                            id,
                            transCtx.typeEnv
                        ) as SMemberAccess
                    );
                } else if (id.defSite instanceof Array) {
                    const letVarField = transCtx.getLetBinding(id);
                    dbgVars.push(
                        registerNode(
                            new SMemberAccess(transCtx.getBindingVarSId(), letVarField),
                            id,
                            transCtx.typeEnv
                        ) as SMemberAccess
                    );
                } else {
                    dbgVars.push(id);
                }
            }

            if (dbgVars.length == 0) {
                debugEventsInfo.push(undefined);
            } else {
                // Next construct the parameters for the event
                const evtParams = dbgVars.map((v) => {
                    const vType = transCtx.typeEnv.typeOf(v);
                    const type = generateTypeAst(vType, factory);
                    const name = v instanceof SId ? v.name : v.member;
                    const typeString = vType instanceof SPointer ? vType.to.pp() : vType.pp();

                    return factory.makeVariableDeclaration(
                        false,
                        false,
                        name,
                        -1,
                        false,
                        DataLocation.Default,
                        StateVariableVisibility.Default,
                        Mutability.Mutable,
                        typeString,
                        undefined,
                        type
                    );
                });

                // Construct the event definition
                const evtDef = factory.makeEventDefinition(
                    true,
                    `P${annot.id}Fail`,
                    factory.makeParameterList(evtParams)
                );

                instrCtx.debugEventDefs.set(annot.id, evtDef);

                const evtArgs = dbgVars.map((v) => generateExprAST(v, transCtx, [contract, fn]));

                // Finally construct the emit statement for the debug event.
                const emitStmt = factory.makeEmitStatement(
                    factory.makeFunctionCall(
                        "<missing>",
                        FunctionCallKind.FunctionCall,
                        factory.makeIdentifierFor(evtDef),
                        evtArgs
                    )
                );
                instrCtx.addAnnotationInstrumentation(annot, emitStmt);

                debugEventsInfo.push([evtDef, emitStmt]);
            }
        }
    }
    const bindingMap: Map<string, SType> = new Map();

    bindings.forEach(([names, type]) => {
        if (typeof names === "string") {
            bindingMap.set(names, type);
        } else {
            for (let i = 0; i < names.length; i++) {
                bindingMap.set(names[i], (type as STupleType).elements[i]);
            }
        }
    });

    // Step 3: Populate the struct def with fields for each temporary variable
    for (const [name, sType] of bindingMap) {
        const astType = generateTypeAst(sType, factory);
        transCtx.addBinding(name, astType);
    }

    const oldAssignments: Assignment[] = [];
    const newAssignments: Assignment[] = [];

    // Step 4: Build the old and new assignments
    for (let i = 0; i < bindings.length; i++) {
        const [names, , expr, isOld] = bindings[i];
        let lhs: Expression;

        if (typeof names === "string") {
            lhs = transCtx.refBinding(names);
        } else {
            lhs = factory.makeTupleExpression(
                "<missing>",
                false,
                names.map((name) => transCtx.refBinding(name))
            );
        }

        const rhs = generateExprAST(expr, transCtx, [contract, fn]);
        const assignment = factory.makeAssignment("<missing>", "=", lhs, rhs);
        instrCtx.addAnnotationInstrumentation(
            bindingToAnnotations.get(i) as PropertyMetaData,
            assignment
        );

        (isOld ? oldAssignments : newAssignments).push(assignment);
    }

    // Step 5: Build the assertion predicates
    const transpiledPredicates = flatExprs.map((flatExpr) =>
        generateExprAST(flatExpr, transCtx, [contract, fn])
    );

    return {
        oldAssignments,
        newAssignments,
        transpiledPredicates,
        debugEventsInfo
    };
}

function getBitPattern(factory: ASTNodeFactory, id: number): Literal {
    const hexId = id.toString(16).padStart(4, "0");
    return factory.makeLiteral(
        "<missing>",
        LiteralKind.Number,
        "",
        "0x" + "cafe".repeat(15) + hexId
    );
}

function emitAssert(
    transCtx: TranspilingContext,
    expr: Expression,
    annotation: PropertyMetaData,
    event: EventDefinition,
    emitStmt?: EmitStatement
): Statement {
    const instrCtx = transCtx.instrCtx;
    const factory = instrCtx.factory;
    let userAssertFailed: Statement;
    let userAssertionHit: Statement | undefined;

    if (instrCtx.assertionMode === "log") {
        const strMessage = `${annotation.id}: ${annotation.message}`;
        const message = factory.makeLiteral("<missing>", LiteralKind.String, "", strMessage);

        userAssertFailed = factory.makeEmitStatement(
            factory.makeFunctionCall(
                "<missing>",
                FunctionCallKind.FunctionCall,
                factory.makeIdentifier("<missing>", "AssertionFailed", event.id),
                [message]
            )
        );
    } else {
        const failBitPattern = getBitPattern(factory, annotation.id);

        userAssertFailed = factory.makeExpressionStatement(
            factory.makeAssignment(
                "<missing>",
                "=",
                transCtx.refBinding(instrCtx.scratchField),
                failBitPattern
            )
        );

        assert(
            annotation.id < 0x1000,
            `Can't instrument more than ${0x1000} ids currently in mstore mode.`
        );

        const successBitPattern = getBitPattern(factory, annotation.id | 0x1000);

        userAssertionHit = factory.makeExpressionStatement(
            factory.makeAssignment(
                "<missing>",
                "=",
                transCtx.refBinding(instrCtx.scratchField),
                successBitPattern
            )
        );
    }

    const ifBody: Statement[] = [userAssertFailed];

    if (emitStmt) {
        ifBody.push(emitStmt);
    }

    if (instrCtx.addAssert) {
        ifBody.push(
            factory.makeExpressionStatement(
                factory.makeFunctionCall(
                    "<missing>",
                    FunctionCallKind.FunctionCall,
                    factory.makeIdentifier("<missing>", "assert", -1),
                    [factory.makeLiteral("bool", LiteralKind.Bool, "0x0", "false")]
                )
            )
        );
    }

    const condition = factory.makeUnaryOperation(
        "bool",
        true,
        "!",
        factory.makeTupleExpression("<missing>", false, [expr])
    );

    const ifStmt = factory.makeIfStatement(condition, factory.makeBlock(ifBody));

    instrCtx.addAnnotationInstrumentation(annotation, userAssertFailed);
    instrCtx.addAnnotationInstrumentation(annotation, ifStmt);
    instrCtx.addAnnotationCheck(annotation, condition);
    instrCtx.addAnnotationFailureCheck(annotation, ...ifBody);

    if (userAssertionHit) {
        instrCtx.addAnnotationInstrumentation(annotation, userAssertionHit);
        return factory.makeBlock([userAssertionHit, ifStmt]);
    }

    return ifStmt;
}

export function getAssertionFailedEvent(
    factory: ASTNodeFactory,
    contract: ContractDefinition
): EventDefinition {
    const events = resolveByName(contract, EventDefinition, "AssertionFailed");

    if (events.length > 0) {
        return events[0];
    }

    const event = factory.makeEventDefinition(
        false,
        "AssertionFailed",
        factory.makeParameterList([])
    );

    event.vParameters.vParameters.push(
        factory.makeVariableDeclaration(
            false,
            false,
            "message",
            event.id,
            false,
            DataLocation.Default,
            StateVariableVisibility.Default,
            Mutability.Mutable,
            "<missing>",
            undefined,
            factory.makeElementaryTypeName("<missing>", "string")
        )
    );

    contract.appendChild(event);

    return event;
}

export function insertInvChecks(
    transCtx: TranspilingContext,
    instrResult: InstrumentationResult,
    annotations: PropertyMetaData[],
    contract: ContractDefinition,
    body: Block
): Recipe {
    const instrCtx = transCtx.instrCtx;
    const factory = instrCtx.factory;
    const recipe: Recipe = [];

    const oldAssignmentStmts: Statement[] = instrResult.oldAssignments.map((oldAssignment) =>
        factory.makeExpressionStatement(oldAssignment)
    );

    const newAssignmentStmts: Statement[] = instrResult.newAssignments.map((newAssignment) =>
        factory.makeExpressionStatement(newAssignment)
    );

    const checkStmts: Statement[] = instrResult.transpiledPredicates.map((predicate, i) => {
        const event = getAssertionFailedEvent(factory, contract);
        const dbgInfo = instrResult.debugEventsInfo[i];
        const emitStmt = dbgInfo !== undefined ? dbgInfo[1] : undefined;
        return emitAssert(transCtx, predicate, annotations[i], event, emitStmt);
    });

    const marker = body.vStatements.length > 0 ? body.vStatements[0] : undefined;

    // Since 0.8.0 arithmetic is checked by default. However the semantics of
    // Scribble is unchecked arithmetic. So we need to wrap annotation
    // computations and checks in unchecked blocks.
    if (gte(instrCtx.compilerVersion, "0.8.0")) {
        if (oldAssignmentStmts.length > 0) {
            const oldAssignmenBlock = factory.makeUncheckedBlock(oldAssignmentStmts);
            recipe.push(
                new InsertStatement(
                    factory,
                    oldAssignmenBlock,
                    marker !== undefined ? "before" : "end",
                    body,
                    marker
                )
            );
        }

        if (newAssignmentStmts.length > 0) {
            const newAssignmenBlock = factory.makeUncheckedBlock(oldAssignmentStmts);
            recipe.push(new InsertStatement(factory, newAssignmenBlock, "end", body));
        }

        const checksBlock = factory.makeUncheckedBlock(checkStmts);
        recipe.push(new InsertStatement(factory, checksBlock, "end", body));
    } else {
        recipe.push(
            ...oldAssignmentStmts.map(
                (oldAssignment) =>
                    new InsertStatement(
                        factory,
                        oldAssignment,
                        marker !== undefined ? "before" : "end",
                        body,
                        marker
                    )
            )
        );

        recipe.push(
            ...newAssignmentStmts.map(
                (newAssignment) => new InsertStatement(factory, newAssignment, "end", body)
            )
        );

        recipe.push(...checkStmts.map((check) => new InsertStatement(factory, check, "end", body)));
    }
    return recipe;
}

function getCheckStateInvsFuncs(
    contract: ContractDefinition,
    ctx: InstrumentationContext
): FunctionDefinition {
    return single(contract.vFunctions.filter((fn) => fn.name === ctx.checkStateInvsFuncName));
}

function isPublic(fn: FunctionDefinition): boolean {
    return [FunctionVisibility.Default, FunctionVisibility.Public].includes(fn.visibility);
}

export class ContractInstrumenter {
    /**
     * Instrument the contract  `contract` with checks for the contract-level invariants in `annotations`.
     * Note that this only emits the functions for checking the contracts.
     * Interposing on the public/external functions in `contract`,
     * incrementing/decrementing the stack depth,
     * and calling the invariant checkers is done in `FunctionInstrumenter`.
     *
     * Interposing on the external callsites, is done in `interposeCall`.
     */
    instrument(
        ctx: InstrumentationContext,
        annotations: AnnotationMetaData[],
        contract: ContractDefinition,
        needsStateInvChecks: boolean
    ): void {
        const recipe: Recipe = [];
        const typeEnv = ctx.typeEnv;
        const semInfo = ctx.semMap;

        const userFunctionsAnnotations = filterByType(annotations, UserFunctionDefinitionMetaData);

        const [, userFuncsRecipe] = this.makeUserFunctions(
            ctx,
            typeEnv,
            semInfo,
            userFunctionsAnnotations,
            contract
        );

        recipe.push(...userFuncsRecipe);

        const propertyAnnotations = filterByType(annotations, PropertyMetaData);
        if (needsStateInvChecks) {
            const [internalInvChecker, internalCheckerRecipe] = this.makeInternalInvariantChecker(
                ctx,
                typeEnv,
                semInfo,
                propertyAnnotations,
                contract
            );

            const [generalInvChecker, generalCheckerRecipe] = this.makeGeneralInvariantChecker(
                ctx,
                contract,
                internalInvChecker
            );

            recipe.push(
                new AddBaseContract(ctx.factory, contract, ctx.utilsContract, "start"),
                ...internalCheckerRecipe,
                ...generalCheckerRecipe,
                ...this.instrumentConstructor(ctx, contract, generalInvChecker),
                ...this.replaceExternalCallSites(ctx, contract, generalInvChecker)
            );

            const utilsUnit = ctx.utilsContract.vScope;
            if (!this.hasImport(contract.vScope, utilsUnit)) {
                const path = relative(
                    dirname(contract.vScope.absolutePath),
                    utilsUnit.absolutePath
                );
                contract.vScope.appendChild(
                    ctx.factory.makeImportDirective(
                        `./${path}`,
                        utilsUnit.absolutePath,
                        "",
                        [],
                        contract.vScope.id,
                        utilsUnit.id
                    )
                );
            }
        }

        cook(recipe);
    }

    private hasImport(unit: SourceUnit, imported: SourceUnit): boolean {
        return (
            unit.vImportDirectives.filter((importD) => importD.vSourceUnit === imported).length > 0
        );
    }

    private makeUserFunctions(
        ctx: InstrumentationContext,
        typeEnv: TypeEnv,
        semInfo: SemMap,
        annotations: UserFunctionDefinitionMetaData[],
        contract: ContractDefinition
    ): [FunctionDefinition[], Recipe] {
        const recipe: Recipe = [];
        const userFuns: FunctionDefinition[] = [];

        const factory = ctx.factory;
        const nameGen = ctx.nameGenerator;

        for (const funDefMD of annotations) {
            const funDef = funDefMD.parsedAnnot;
            const instrFunName = nameGen.getFresh(funDef.name.name, true);
            const userFun = factory.makeFunctionDefinition(
                contract.id,
                FunctionKind.Function,
                instrFunName,
                false,
                FunctionVisibility.Internal,
                FunctionStateMutability.View,
                false,
                factory.makeParameterList([]),
                factory.makeParameterList([]),
                [],
                undefined,
                factory.makeBlock([]),
                `Implementation of user function ${funDef.pp()}`
            );

            ctx.userFunctions.set(funDef, userFun);

            // Arithmetic in Solidity >= 0.8.0 is checked by default.
            // In Scribble its unchecked.
            let body: Block | UncheckedBlock;
            if (gte(ctx.compilerVersion, "0.8.0")) {
                body = factory.makeUncheckedBlock([]);
                (userFun.vBody as Block).appendChild(body);
            } else {
                body = userFun.vBody as Block;
            }

            const transCtx = ctx.getTranspilingCtx(userFun);

            for (let i = 0; i < funDef.parameters.length; i++) {
                const [, paramType] = funDef.parameters[i];
                const instrName = transCtx.getUserFunArg(funDef, i);
                userFun.vParameters.appendChild(generateFunVarDecl(instrName, paramType, factory));
            }

            const retDecl = generateFunVarDecl("", funDef.returnType, factory);
            userFun.vReturnParameters.appendChild(retDecl);
            ctx.addGeneralInstrumentation(retDecl);

            const [flatBody, bindings] = flattenExpr(funDef.body, transCtx);

            if (bindings.length > 0) {
                const bindingMap: Map<string, SType> = new Map();

                bindings.forEach(([names, type]) => {
                    if (typeof names === "string") {
                        bindingMap.set(names, type);
                    } else {
                        for (let i = 0; i < names.length; i++) {
                            bindingMap.set(names[i], (type as STupleType).elements[i]);
                        }
                    }
                });

                // Step 3: Populate the struct def with fields for each temporary variable
                for (const [name, sType] of bindingMap) {
                    transCtx.addBinding(name, generateTypeAst(sType, factory));
                }

                // Step 4: Build temp assignments
                for (const [names, , expr, isOld] of bindings) {
                    let lhs: Expression;
                    assert(!isOld, `Unexpected old expresion in user function: ${expr.pp()}`);

                    if (typeof names === "string") {
                        lhs = transCtx.refBinding(names);
                    } else {
                        lhs = factory.makeTupleExpression(
                            "<missing>",
                            false,
                            names.map(transCtx.refBinding)
                        );
                    }

                    const rhs = generateExprAST(expr, transCtx, [contract, userFun]);
                    const assignment = factory.makeAssignment("<missing>", "=", lhs, rhs);

                    body.appendChild(factory.makeExpressionStatement(assignment));
                }
            }

            // Step 5: Build the final result
            const result = generateExprAST(flatBody, transCtx, [contract, userFun]);
            body.appendChild(factory.makeReturn(userFun.vReturnParameters.id, result));

            ctx.addGeneralInstrumentation(body);
            userFuns.push(userFun);
            recipe.push(new InsertFunction(factory, contract, userFun));
        }

        return [userFuns, recipe];
    }

    private makeInternalInvariantChecker(
        ctx: InstrumentationContext,
        typeEnv: TypeEnv,
        semInfo: SemMap,
        annotations: PropertyMetaData[],
        contract: ContractDefinition
    ): [FunctionDefinition, Recipe] {
        const factory = ctx.factory;
        const recipe: Recipe = [];

        const body = factory.makeBlock([]);
        const mut = changesMutability(ctx)
            ? FunctionStateMutability.NonPayable
            : FunctionStateMutability.View;
        const checker = factory.makeFunctionDefinition(
            contract.id,
            FunctionKind.Function,
            ctx.getInternalInvariantCheckerName(contract),
            false,
            FunctionVisibility.Internal,
            mut,
            false,
            factory.makeParameterList([]),
            factory.makeParameterList([]),
            [],
            undefined,
            body,
            factory.makeStructuredDocumentation(
                `Check only the current contract's state invariants`
            )
        );

        const transCtx = ctx.getTranspilingCtx(checker);

        const instrResult = generateExpressions(annotations, transCtx);

        assert(instrResult.oldAssignments.length === 0, ``);

        recipe.push(new InsertFunction(ctx.factory, contract, checker));

        assert(instrResult.oldAssignments.length === 0, ``);

        for (const dbgInfo of instrResult.debugEventsInfo) {
            if (dbgInfo !== undefined) {
                recipe.push(new InsertEvent(factory, contract, dbgInfo[0]));
            }
        }

        recipe.push(...insertInvChecks(transCtx, instrResult, annotations, contract, body));

        return [checker, recipe];
    }

    /**
     * The actual contract invariant evaluation logic is split into two parts to deal with inheritance.
     * For each contract C we emit a concrete internal function __scribble_C_check_state_invariants_internal,
     * in which we evaluate the annotations for _ONLY_ 'C'. This is done by makeInternalInvariantChecker.
     *
     * Additionally we emit a virtual (overriden) function `__scribble_check_state_invariants` that
     * calls __scribble_X_check_state_invariants_internal for the current contract, and each of the bases of the current contract.
     * This is emited below.
     *
     * @param ctx
     * @param contract
     * @param internalInvChecker
     */
    private makeGeneralInvariantChecker(
        ctx: InstrumentationContext,
        contract: ContractDefinition,
        internalInvChecker: FunctionDefinition
    ): [FunctionDefinition, Recipe] {
        const factory = ctx.factory;
        const directBases = (ctx.cha.parents.get(contract) as ContractDefinition[])?.filter(
            (base) =>
                base.kind === ContractKind.Contract &&
                base !== ctx.utilsContract &&
                base !== contract
        );
        const recipe: Recipe = [];

        let overrideSpecifier: OverrideSpecifier | undefined = undefined;

        if (directBases.length == 1) {
            // Single base, don't need to specify explicit classes in override specifier
            overrideSpecifier = factory.makeOverrideSpecifier([]);
        } else if (directBases.length > 1) {
            overrideSpecifier = factory.makeOverrideSpecifier(
                directBases.map((base) =>
                    factory.makeUserDefinedTypeName("<missing>", base.name, base.id)
                )
            );
        }

        const mut = changesMutability(ctx)
            ? FunctionStateMutability.NonPayable
            : FunctionStateMutability.View;

        const checker = factory.makeFunctionDefinition(
            contract.id,
            FunctionKind.Function,
            ctx.checkStateInvsFuncName,
            true, // general invariant checker is always virtual
            FunctionVisibility.Internal,
            mut,
            false,
            factory.makeParameterList([]),
            factory.makeParameterList([]),
            [],
            overrideSpecifier, // non-root functions must have an override specifier
            factory.makeBlock([]),
            factory.makeStructuredDocumentation(
                `Check the state invariant for the current contract and all its bases`
            )
        );

        recipe.push(new InsertFunction(factory, contract, checker));

        const body = checker.vBody as Block;

        for (const base of contract.vLinearizedBaseContracts) {
            assert(base !== ctx.utilsContract, "");

            if (base.kind === ContractKind.Interface) {
                continue;
            }

            const callExpr =
                base === contract
                    ? factory.makeIdentifierFor(internalInvChecker)
                    : factory.makeIdentifier(
                          "<missing>",
                          ctx.getInternalInvariantCheckerName(base),
                          -1
                      );

            const callInternalCheckInvs = factory.makeExpressionStatement(
                factory.makeFunctionCall("<missing>", FunctionCallKind.FunctionCall, callExpr, [])
            );

            ctx.addGeneralInstrumentation(callInternalCheckInvs);
            recipe.push(new InsertStatement(factory, callInternalCheckInvs, "end", body));
        }

        return [checker, recipe];
    }

    /**
     * Contract invariants need to be checked at the end of the constructor. If there is no constructor insert a default constructor.
     *
     * @param ctx
     * @param contract
     * @param generalInvChecker
     */
    private instrumentConstructor(
        ctx: InstrumentationContext,
        contract: ContractDefinition,
        generalInvChecker: FunctionDefinition
    ): Recipe {
        const factory = ctx.factory;
        const recipe: Recipe = [];

        let constructor: FunctionDefinition;
        let body: Block;

        if (contract.vConstructor === undefined) {
            body = factory.makeBlock([]);
            constructor = factory.makeFunctionDefinition(
                contract.id,
                FunctionKind.Constructor,
                "",
                false,
                FunctionVisibility.Public,
                FunctionStateMutability.NonPayable,
                true,
                factory.makeParameterList([]),
                factory.makeParameterList([]),
                [],
                undefined,
                body
            );

            recipe.push(new AddConstructor(factory, contract, constructor));
        } else {
            constructor = contract.vConstructor;
            body = constructor.vBody as Block;
        }

        const entryGuard = factory.makeExpressionStatement(
            factory.makeAssignment(
                "<missing>",
                "=",
                factory.makeIdentifier("bool", ctx.outOfContractFlagName, -1),
                factory.makeLiteral("bool", LiteralKind.Bool, "", "false")
            )
        );

        const callCheckInvs = factory.makeExpressionStatement(
            factory.makeFunctionCall(
                "<missing>",
                FunctionCallKind.FunctionCall,
                factory.makeIdentifierFor(generalInvChecker),
                []
            )
        );

        const exitGuard = factory.makeExpressionStatement(
            factory.makeAssignment(
                "<missing>",
                "=",
                factory.makeIdentifier("bool", ctx.outOfContractFlagName, -1),
                factory.makeLiteral("bool", LiteralKind.Bool, "", "true")
            )
        );

        ctx.addGeneralInstrumentation(entryGuard, callCheckInvs, exitGuard);

        recipe.push(
            new InsertStatement(factory, entryGuard, "start", body),
            new InsertStatement(factory, callCheckInvs, "end", body),
            new InsertStatement(factory, exitGuard, "end", body)
        );

        return recipe;
    }

    private replaceExternalCallSites(
        ctx: InstrumentationContext,
        contract: ContractDefinition,
        generalInvChecker: FunctionDefinition
    ): Recipe {
        const factory = ctx.factory;
        const recipe: Recipe = [];

        for (const callSite of findExternalCalls(contract)) {
            const containingFun = callSite.getClosestParentByType(FunctionDefinition);

            if (
                containingFun !== undefined &&
                [FunctionKind.Fallback, FunctionKind.Receive].includes(containingFun.kind)
            ) {
                // Cannot instrument receive() and fallback()
                continue;
            }

            const calleeType = parseTypeString(callSite.vExpression.typeString);
            assert(
                calleeType instanceof SFunctionType,
                `Expected function type not ${calleeType.pp()} for calee in ${callSite.print()}`
            );

            if (calleeType.mutability === FunctionStateMutability.Pure) {
                continue;
            }

            const [callsiteRecipe, callsiteWrapper] = interposeCall(ctx, contract, callSite);

            const wrapperBody = callsiteWrapper.vBody as Block;

            wrapperBody.vStatements.splice(
                0,
                0,
                factory.makeExpressionStatement(
                    factory.makeFunctionCall(
                        "<missing>",
                        FunctionCallKind.FunctionCall,
                        factory.makeIdentifierFor(generalInvChecker),
                        []
                    )
                )
            );

            /**
             * Subtlety: We DONT set the `OUT_OF_CONTRACT` when the external
             * function call we are wrapping around is pure/view, but we STILL
             * check the invariants as this is an externally observable point.
             *
             * Note that a pure/view external call can only re-enter the
             * contract at a pure or view function, at which we don't check
             * state invariants, and don't mutate the OUT_OF_CONTRACT
             * variable.
             */
            if (isChangingState(callsiteWrapper)) {
                wrapperBody.vStatements.splice(
                    1,
                    0,
                    factory.makeExpressionStatement(
                        factory.makeAssignment(
                            "<missing>",
                            "=",
                            factory.makeIdentifier("bool", ctx.outOfContractFlagName, -1),
                            factory.makeLiteral("bool", LiteralKind.Bool, "", "true")
                        )
                    )
                );
                wrapperBody.appendChild(
                    factory.makeExpressionStatement(
                        factory.makeAssignment(
                            "<missing>",
                            "=",
                            factory.makeIdentifier("bool", ctx.outOfContractFlagName, -1),
                            factory.makeLiteral("bool", LiteralKind.Bool, "", "false")
                        )
                    )
                );
            }

            recipe.push(...callsiteRecipe);
        }

        return recipe;
    }
}

export class FunctionInstrumenter {
    /**
     * Instrument the function `fn` in contract `contract`
     * with checks for the function-level invariants in `annotations`.
     */
    instrument(
        ctx: InstrumentationContext,
        allAnnotations: AnnotationMetaData[],
        contract: ContractDefinition,
        fn: FunctionDefinition,
        needsContractInvInstr: boolean
    ): void {
        const factory = ctx.factory;

        const annotations = filterByType(allAnnotations, PropertyMetaData);
        assert(
            allAnnotations.length === annotations.length,
            `NYI: Non-property annotations on functions.`
        );

        const [interposeRecipe, stub] = interpose(fn, ctx);

        cook(interposeRecipe);

        const body = stub.vBody as Block;

        const originalCall = single(
            body.vStatements,
            `Expected stub block for ${stub.name} have a single statement (call to original function), not ${body.vStatements.length}`
        );

        const transCtx = ctx.getTranspilingCtx(stub);

        const instrResult = generateExpressions(annotations, transCtx);

        const recipe: Recipe = [];

        // We only need to check state invariants on functions that are:
        //      1) Not in a library
        //      2) public or external
        //      3) mutating state (non-payable or payable)
        //      4) not the fallback() functions (since it may receive staticcalls)
        const checkStateInvs =
            needsContractInvInstr &&
            isExternallyVisible(stub) &&
            isChangingState(stub) &&
            fn.kind !== FunctionKind.Fallback;

        for (const dbgInfo of instrResult.debugEventsInfo) {
            if (dbgInfo !== undefined) {
                recipe.push(new InsertEvent(factory, contract, dbgInfo[0]));
            }
        }

        if (checkStateInvs) {
            recipe.push(
                ...this.insertEnterMarker(factory, instrResult, stub, originalCall, transCtx)
            );
        }

        recipe.push(...insertInvChecks(transCtx, instrResult, annotations, contract, body));

        if (checkStateInvs) {
            recipe.push(...this.insertExitMarker(factory, instrResult, contract, stub, transCtx));
        }

        cook(recipe);
    }

    private insertEnterMarker(
        factory: ASTNodeFactory,
        instrResult: InstrumentationResult,
        stub: FunctionDefinition,
        originalCall: Statement,
        transCtx: TranspilingContext
    ): Recipe {
        const body = stub.vBody as Block;
        const instrCtx = transCtx.instrCtx;

        const recipe: Recipe = [];

        if (stub.visibility === FunctionVisibility.External) {
            const enter = factory.makeExpressionStatement(
                factory.makeAssignment(
                    "<missing>",
                    "=",
                    factory.makeIdentifier("<missing>", instrCtx.outOfContractFlagName, -1),
                    factory.makeLiteral("<missing>", LiteralKind.Bool, "", "false")
                )
            );

            instrCtx.addGeneralInstrumentation(enter);

            recipe.push(new InsertStatement(factory, enter, "before", body, originalCall));
        } else if (isPublic(stub)) {
            transCtx.addBinding(
                instrCtx.checkInvsFlag,
                factory.makeElementaryTypeName("<missing>", "bool")
            );

            const storeEntry = factory.makeExpressionStatement(
                factory.makeAssignment(
                    "<missing>",
                    "=",
                    transCtx.refBinding(instrCtx.checkInvsFlag),
                    factory.makeIdentifier("<missing>", instrCtx.outOfContractFlagName, -1)
                )
            );

            recipe.push(new InsertStatement(factory, storeEntry, "before", body, originalCall));

            const enter = factory.makeExpressionStatement(
                factory.makeAssignment(
                    "<missing>",
                    "=",
                    factory.makeIdentifier("<missing>", instrCtx.outOfContractFlagName, -1),
                    factory.makeLiteral("<missing>", LiteralKind.Bool, "", "false")
                )
            );

            instrCtx.addGeneralInstrumentation(storeEntry, enter);
            recipe.push(new InsertStatement(factory, enter, "before", body, originalCall));
        }

        return recipe;
    }

    private insertExitMarker(
        factory: ASTNodeFactory,
        instrResult: InstrumentationResult,
        contract: ContractDefinition,
        stub: FunctionDefinition,
        transCtx: TranspilingContext
    ): Recipe {
        const instrCtx = transCtx.instrCtx;
        const body = stub.vBody as Block;

        const recipe: Recipe = [];

        const checkInvsCall = factory.makeExpressionStatement(
            factory.makeFunctionCall(
                "<missing>",
                FunctionCallKind.FunctionCall,
                factory.makeIdentifierFor(getCheckStateInvsFuncs(contract, instrCtx)),
                []
            )
        );

        instrCtx.addGeneralInstrumentation(checkInvsCall);

        if (isPublic(stub)) {
            const ifStmt = factory.makeIfStatement(
                transCtx.refBinding(instrCtx.checkInvsFlag),
                checkInvsCall
            );

            instrCtx.addGeneralInstrumentation(ifStmt);
            recipe.push(new InsertStatement(factory, ifStmt, "end", body));
        } else {
            recipe.push(new InsertStatement(factory, checkInvsCall, "end", body));
        }

        const exit = factory.makeExpressionStatement(
            factory.makeAssignment(
                "<missing>",
                "=",
                factory.makeIdentifier("<missing>", instrCtx.outOfContractFlagName, -1),
                stub.visibility === FunctionVisibility.External
                    ? factory.makeLiteral("bool", LiteralKind.Bool, "", "true")
                    : transCtx.refBinding(instrCtx.checkInvsFlag)
            )
        );

        instrCtx.addGeneralInstrumentation(exit);
        recipe.push(new InsertStatement(factory, exit, "end", body));

        return recipe;
    }
}

/**
 * Return the constructor of `contract`. If there is no constructor defined,
 * add an empty public constructor and return it.
 */
export function getOrAddConstructor(
    contract: ContractDefinition,
    factory: ASTNodeFactory
): FunctionDefinition {
    if (contract.vConstructor !== undefined) {
        return contract.vConstructor;
    }

    const emptyConstructor = factory.makeFunctionDefinition(
        contract.id,
        FunctionKind.Constructor,
        "",
        false,
        FunctionVisibility.Public,
        FunctionStateMutability.NonPayable,
        true,
        factory.makeParameterList([]),
        factory.makeParameterList([]),
        [],
        undefined,
        factory.makeBlock([])
    );

    contract.appendChild(emptyConstructor);

    return emptyConstructor;
}
