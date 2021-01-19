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
    MemberAccess,
    Mutability,
    OverrideSpecifier,
    resolveByName,
    SourceUnit,
    Statement,
    StateVariableVisibility,
    StructDefinition,
    VariableDeclaration,
    EmitStatement,
    Literal
} from "solc-typed-ast";
import {
    AddBaseContract,
    AddConstructor,
    cook,
    InsertFunction,
    InsertStatement,
    InsertStructDef,
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
    SResult
} from "../spec-lang/ast";
import { TypeMap, SemMap } from "../spec-lang/tc";
import { parse as parseType } from "../spec-lang/type_parser";
import { UIDGenerator } from "../uid_generator";
import { assert, isChangingState, isExternallyVisible, single } from "../util";
import { Annotation } from "./annotations";
import { CallGraph, FunSet } from "./callgraph";
import { CHA } from "./cha";
import { walk } from "../spec-lang/walk";
import { interpose, interposeCall } from "./interpose";
import { generateExprAST, generateTypeAst } from "./transpile";
import { dirname, relative } from "path";

export type SBinding = [string | string[], SType, SNode, boolean];
export type SBindings = SBinding[];

export type AnnotationFilterOptions = {
    type?: string;
    message?: string;
};

export interface InstrumentationContext {
    factory: ASTNodeFactory;
    units: SourceUnit[];
    assertionMode: "log" | "mstore";
    addAssert: boolean;
    utilsContract: ContractDefinition;
    callgraph: CallGraph;
    cha: CHA<ContractDefinition>;
    funsToChangeMutability: FunSet;
    filterOptions: AnnotationFilterOptions;
    annotations: Annotation[];
    wrapperMap: Map<FunctionDefinition, FunctionDefinition>;
    files: Map<string, string>;
    compilerVersion: string;
    debugEvents: boolean;
    debugEventDefs: Map<number, EventDefinition>;
}

export interface InstrumentationResult {
    struct: StructDefinition;
    structLocalVariable: VariableDeclaration;
    oldAssignments: Assignment[];
    newAssignments: Assignment[];
    transpiledPredicates: Expression[];
    debugEventsInfo: Array<[EventDefinition, EmitStatement] | undefined>;
}

/// Return true if the current instrumentation configuration requires
/// instrumented pure/view functions to become non-payable
export function changesMutability(ctx: InstrumentationContext): boolean {
    return ctx.assertionMode === "log";
}

const uid = new UIDGenerator();
const SCRIBBLE_VAR = "_v";
const MSTORE_SCRATCH_FIELD = "__mstore_scratch__";
const DUMMY_PREFIX = "dummy_";
const REENTRANCY_UTILS_CONTRACT = "__scribble_ReentrancyUtils";
const CHECK_STATE_INVS_FUN = "__scribble_check_state_invariants";
const OUT_OF_CONTRACT = "__scribble_out_of_contract";
const CHECK_INVS_AT_END = "__scribble_check_invs_at_end";

export function getAllNames(contract: ContractDefinition): Set<string> {
    const nameSet: Set<string> = new Set();
    for (const v of contract.getChildren()) {
        if ("name" in v) nameSet.add(v["name"]);
    }
    return nameSet;
}

export function getNamesInFuncScope(
    contract: ContractDefinition,
    fn: FunctionDefinition
): Set<string> {
    const stateVarSet: Set<string> = new Set(contract.vStateVariables.map((item) => item.name));
    const globalNamesInScope: Set<string> = new Set([
        ...stateVarSet,
        ...contract.vFunctions.map((item) => item.name)
    ]);
    return new Set([
        ...globalNamesInScope,
        ...fn.getChildrenByType(VariableDeclaration).map((item) => item.name)
    ]);
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
            const calleeType = parseType(call.vExpression.typeString);

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
    version: string
): SourceUnit {
    const exportedSymbols = new Map();
    const sourceUnit = factory.makeSourceUnit(sourceEntryKey, -1, path, exportedSymbols);
    sourceUnit.appendChild(factory.makePragmaDirective(["solidity", version]));

    const contract = factory.makeContractDefinition(
        REENTRANCY_UTILS_CONTRACT,
        sourceUnit.id,
        ContractKind.Contract,
        false,
        true,
        [],
        `Utility contract holding a stack counter`
    );

    sourceUnit.appendChild(contract);

    const counter = factory.makeVariableDeclaration(
        false,
        false,
        OUT_OF_CONTRACT,
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

    contract.appendChild(counter);

    return sourceUnit;
}

function gatherDebugIds(n: SNode, typing: TypeMap): Set<SId> {
    const debugIds: Map<string, SId> = new Map();
    const selectId = (id: SId): void => {
        // Only want let-bindings and variable identifiers
        if (!(id.defSite instanceof Array || id.defSite instanceof VariableDeclaration)) {
            return;
        }

        const key =
            id.defSite instanceof VariableDeclaration
                ? `${id.defSite.id}`
                : `${id.defSite[0].id}_${id.defSite[1]}`;

        if (debugIds.has(key)) {
            return;
        }

        const type = typing.get(id);
        assert(type !== undefined, ``);

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

function registerNode(newN: SNode, oldN: SNode, typing: TypeMap): SNode {
    const oldT = typing.get(oldN);

    if (oldT) typing.set(newN, oldT);
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
export function flattenExpr(
    expr: SNode,
    typing: TypeMap,
    semInfo: SemMap,
    target: FunctionDefinition,
    varStruct: VariableDeclaration
): [SNode, SBindings] {
    /**
     * Register the new flattened node `newN`, which corresponds to an old unflattened node `oldN` in the typing map.
     * If `oldN` has a type in `typing` assign the same type to `newN`.
     *
     * @param newN {SNode} - new node
     * @param oldN {SNode} - corresponding old node
     */
    const _registerNode = (newN: SNode, oldN: SNode): SNode => {
        return registerNode(newN, oldN, typing);
    };

    const getTmpVar = (name: string, oldN: SNode, src?: Range) => {
        const id = new SId(varStruct.name);

        id.defSite = varStruct;

        return _registerNode(new SMemberAccess(id, name, src), oldN);
    };

    if (expr instanceof SId) {
        // Case when the id is a let variable part of a function tuple return (e.g. `x` in `let x, y:= foo() in x`)
        if (expr.defSite instanceof Array) {
            return [getTmpVar(expr.name, expr, expr.src), []];
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
        const [flatBase, baseBindings] = flattenExpr(expr.base, typing, semInfo, target, varStruct);
        const [flatIndex, indexBindings] = flattenExpr(
            expr.index,
            typing,
            semInfo,
            target,
            varStruct
        );

        return [
            _registerNode(new SIndexAccess(flatBase, flatIndex, expr.src), expr),
            baseBindings.concat(indexBindings)
        ];
    }

    if (expr instanceof SMemberAccess) {
        const [flatBase, baseBindings] = flattenExpr(expr.base, typing, semInfo, target, varStruct);
        const flattenedExpr = new SMemberAccess(flatBase, expr.member, expr.src);

        return [_registerNode(flattenedExpr, expr), baseBindings];
    }

    if (expr instanceof SUnaryOperation) {
        const [flatSubexp, subexpBindings] = flattenExpr(
            expr.subexp,
            typing,
            semInfo,
            target,
            varStruct
        );

        if (expr.op === "old") {
            const tmpName = uid.get("old_");
            const tmpType = typing.get(expr) as SType;

            subexpBindings.push([tmpName, tmpType, flatSubexp, true]);

            return [getTmpVar(tmpName, expr, expr.src), subexpBindings];
        }

        return [
            _registerNode(new SUnaryOperation(expr.op, flatSubexp, expr.src), expr),
            subexpBindings
        ];
    }

    if (expr instanceof SBinaryOperation) {
        const [flatLeft, leftBindings] = flattenExpr(expr.left, typing, semInfo, target, varStruct);
        const [flatRight, rightBindings] = flattenExpr(
            expr.right,
            typing,
            semInfo,
            target,
            varStruct
        );

        return [
            _registerNode(new SBinaryOperation(flatLeft, expr.op, flatRight, expr.src), expr),
            leftBindings.concat(rightBindings)
        ];
    }

    if (expr instanceof SConditional) {
        const [flatCond, condBindings] = flattenExpr(
            expr.condition,
            typing,
            semInfo,
            target,
            varStruct
        );
        const [flatTrue, trueBindings] = flattenExpr(
            expr.trueExp,
            typing,
            semInfo,
            target,
            varStruct
        );
        const [flatFalse, falseBindings] = flattenExpr(
            expr.falseExp,
            typing,
            semInfo,
            target,
            varStruct
        );

        return [
            _registerNode(new SConditional(flatCond, flatTrue, flatFalse, expr.src), expr),
            condBindings.concat(trueBindings).concat(falseBindings)
        ];
    }

    if (expr instanceof SFunctionCall) {
        const [flatCallee, calleeBindings] = flattenExpr(
            expr.callee,
            typing,
            semInfo,
            target,
            varStruct
        );
        const flatArgs: SNode[] = [];
        const argBindings: SBindings[] = [];

        expr.args.forEach((arg: SNode) => {
            const [flatArg, argBinding] = flattenExpr(arg, typing, semInfo, target, varStruct);

            flatArgs.push(flatArg);

            argBindings.push(argBinding);
        });

        return [
            _registerNode(new SFunctionCall(flatCallee, flatArgs, expr.src), expr),
            argBindings.reduce((acc, cur) => acc.concat(cur), calleeBindings)
        ];
    }

    if (expr instanceof SLet) {
        const bindingName = (name: string) => (name === "_" ? uid.get(DUMMY_PREFIX) : name);

        const rhsT = typing.get(expr.rhs) as SType;
        // Hack to support old(fun()) where fun returns multiple types. Should be
        // removed when we get propper tuples support.
        let flatRHS: SNode;
        let rhsBindings: SBindings;

        if (
            rhsT instanceof STupleType &&
            expr.rhs instanceof SUnaryOperation &&
            expr.rhs.op === "old"
        ) {
            [flatRHS, rhsBindings] = flattenExpr(
                expr.rhs.subexp,
                typing,
                semInfo,
                target,
                varStruct
            );
        } else {
            [flatRHS, rhsBindings] = flattenExpr(expr.rhs, typing, semInfo, target, varStruct);
        }

        let bindings: SBindings;
        const rhsSemInfo = semInfo.get(expr.rhs);
        assert(rhsSemInfo !== undefined, `Missing sem info for let rhs-expr in ${expr.pp()}`);

        if (rhsT instanceof STupleType) {
            if (flatRHS instanceof SResult) {
                assert(
                    expr.lhs.length === target.vReturnParameters.vParameters.length &&
                        expr.lhs.length === rhsT.elements.length,
                    `Internal error: mismatch between let lhs and righ-hand side $result`
                );

                bindings = [];
                for (let i = 0; i < expr.lhs.length; i++) {
                    const rhs = new SId(target.vReturnParameters.vParameters[i].name);
                    rhs.defSite = target.vReturnParameters.vParameters[i];
                    bindings.push([
                        bindingName(expr.lhs[i].name),
                        rhsT.elements[i],
                        rhs,
                        rhsSemInfo.isOld
                    ]);
                }
            } else {
                bindings = [
                    [expr.lhs.map((id) => bindingName(id.name)), rhsT, flatRHS, rhsSemInfo.isOld]
                ];
            }
        } else {
            bindings = [[bindingName(single(expr.lhs).name), rhsT, flatRHS, rhsSemInfo.isOld]];
        }

        const [flatIn, inBindings] = flattenExpr(expr.in, typing, semInfo, target, varStruct);

        const letBindings = rhsBindings.concat(bindings).concat(inBindings);
        const tmpName = uid.get("let_");
        const tmpType = typing.get(expr) as SType;

        const inSemInfo = semInfo.get(expr.in);
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
 * Generate all the neccessary AST nodes to evaluate a given spec expression.
 *
 * @param exprs - specification expression to evaluate
 * @param typing - type map
 * @param factory - factory for building AST nodes
 * @param loc - context where the expression is to be evaluated. Either a contract, or a particular function inside a contract.
 */
export function generateExpressions(
    annotations: Annotation[],
    ctx: InstrumentationContext,
    typing: TypeMap,
    semInfo: SemMap,
    contract: ContractDefinition,
    fn: FunctionDefinition
): InstrumentationResult {
    // Step 1: Define struct holding all the temporary variables neccessary
    const exprs = annotations.map((annot) => annot.expression);
    const factory = ctx.factory;
    const allNames = getAllNames(contract);

    let possibleStructName = uid.get("vars");
    while (allNames.has(possibleStructName)) {
        possibleStructName = uid.get("vars");
    }

    const structName = possibleStructName;
    const canonicalStructName = `${contract.name}.${structName}`;
    const struct = factory.makeStructDefinition(
        structName,
        canonicalStructName,
        contract.id,
        FunctionVisibility.Private,
        []
    );

    if (ctx.assertionMode === "mstore") {
        const decl = factory.makeVariableDeclaration(
            false,
            false,
            MSTORE_SCRATCH_FIELD,
            struct.id,
            false,
            DataLocation.Default,
            StateVariableVisibility.Default,
            Mutability.Mutable,
            "<missing>",
            undefined,
            factory.makeElementaryTypeName("<missing>", "uint256")
        );
        struct.appendChild(decl);
    }

    const namesInFuncScope = getNamesInFuncScope(contract, fn);
    let varName = SCRIBBLE_VAR;
    if (namesInFuncScope.has(varName)) {
        let idx = 1;
        while (namesInFuncScope.has(varName + `_${idx}`)) {
            idx += 1;
        }
        varName += `_${idx}`;
    }

    const structLocalVariable = factory.makeVariableDeclaration(
        false,
        false,
        varName,
        fn.id,
        false,
        DataLocation.Memory,
        StateVariableVisibility.Default,
        Mutability.Mutable,
        "<missing>",
        undefined,
        factory.makeUserDefinedTypeName("<missing>", structName, struct.id)
    );

    // Step 2: Flatten all predicates, turning let-bindings and old-keywords to temporary variables
    const flatExprs: SNode[] = [];
    const bindings: SBindings = [];

    for (const expr of exprs) {
        const [flatExpr, oneBindings] = flattenExpr(expr, typing, semInfo, fn, structLocalVariable);

        flatExprs.push(flatExpr);

        bindings.push(...oneBindings);
    }

    // Step 2.5: If `--debug-events` is specified compute the debug event for
    // every annotation.
    const debugEventsInfo: Array<[EventDefinition, EmitStatement] | undefined> = [];
    if (ctx.debugEvents) {
        for (const annot of annotations) {
            const dbgVars: Array<SId | SMemberAccess> = [];
            // First create the actual expression corresponding to each variable
            // to be traced
            for (const id of gatherDebugIds(annot.expression, typing)) {
                const info = semInfo.get(id);
                const idType = typing.get(id);
                assert(
                    info !== undefined && idType !== undefined,
                    `Internal: No type or seminfo computed for ${id.pp()}`
                );

                const baseVar = new SId(structLocalVariable.name);
                baseVar.defSite = structLocalVariable;

                if (info.isOld && id.defSite instanceof VariableDeclaration) {
                    const tmpName = `dbg_old_${id.name}`;
                    bindings.push([tmpName, idType, id, true]);

                    dbgVars.push(
                        registerNode(
                            new SMemberAccess(baseVar, tmpName),
                            id,
                            typing
                        ) as SMemberAccess
                    );
                } else if (id.defSite instanceof Array) {
                    dbgVars.push(
                        registerNode(
                            new SMemberAccess(baseVar, id.name),
                            id,
                            typing
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
                    const vType = typing.get(v) as SType;
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

                ctx.debugEventDefs.set(annot.id, evtDef);

                const evtArgs = dbgVars.map((v) =>
                    generateExprAST(v, typing, factory, [contract, fn])
                );

                // Finally construct the emit statement for the debug event.
                const emitStmt = factory.makeEmitStatement(
                    factory.makeFunctionCall(
                        "<missing>",
                        FunctionCallKind.FunctionCall,
                        factory.makeIdentifierFor(evtDef),
                        evtArgs
                    )
                );

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
    const memberDeclMap: Map<string, VariableDeclaration> = new Map();

    for (const [name, sType] of bindingMap) {
        if (name.startsWith(DUMMY_PREFIX)) {
            continue;
        }

        const astType = generateTypeAst(sType, factory);
        const decl = factory.makeVariableDeclaration(
            false,
            false,
            name,
            struct.id,
            false,
            DataLocation.Default,
            StateVariableVisibility.Default,
            Mutability.Mutable,
            "<missing>",
            undefined,
            astType
        );

        struct.appendChild(decl);

        memberDeclMap.set(name, decl);
    }

    const getTmpVar = (name: string): MemberAccess =>
        factory.makeMemberAccess(
            "<missing>",
            factory.makeIdentifierFor(structLocalVariable),
            name,
            (memberDeclMap.get(name) as VariableDeclaration).id
        );

    const oldAssignments: Assignment[] = [];
    const newAssignments: Assignment[] = [];

    // Step 4: Build the old and new assignments
    for (const [names, , expr, isOld] of bindings) {
        let lhs: Expression;

        if (typeof names === "string") {
            if (names.startsWith(DUMMY_PREFIX)) {
                continue;
            }

            lhs = getTmpVar(names);
        } else {
            lhs = factory.makeTupleExpression(
                "<missing>",
                false,
                names.map((name) => (name.startsWith(DUMMY_PREFIX) ? null : getTmpVar(name)))
            );
        }

        const rhs = generateExprAST(expr, typing, factory, [contract, fn]);
        const assignment = factory.makeAssignment("<missing>", "=", lhs, rhs);

        (isOld ? oldAssignments : newAssignments).push(assignment);
    }

    // Step 5: Build the assertion predicates
    const transpiledPredicates = flatExprs.map((flatExpr) =>
        generateExprAST(flatExpr, typing, factory, [contract, fn])
    );

    return {
        struct,
        structLocalVariable,
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
    ctx: InstrumentationContext,
    expr: Expression,
    annotation: Annotation,
    event: EventDefinition,
    structLocalVar: VariableDeclaration,
    emitStmt?: EmitStatement
): Statement {
    const factory = ctx.factory;
    let userAssertFailed: Statement;
    let userAssertionHit: Statement | undefined;

    if (ctx.assertionMode === "log") {
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
        const id = factory.makeIdentifierFor(structLocalVar);
        const failBitPattern = getBitPattern(factory, annotation.id);
        userAssertFailed = factory.makeExpressionStatement(
            factory.makeAssignment(
                "<missing>",
                "=",
                factory.makeMemberAccess("<missing>", id, MSTORE_SCRATCH_FIELD, -1),
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
                factory.makeMemberAccess("<missing>", id, MSTORE_SCRATCH_FIELD, -1),
                successBitPattern
            )
        );
    }
    const ifBody: Statement[] = [userAssertFailed];

    if (emitStmt) {
        ifBody.push(emitStmt);
    }

    if (ctx.addAssert) {
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

    if (userAssertionHit) {
        return factory.makeBlock([userAssertionHit, ifStmt]);
    } else {
        return ifStmt;
    }
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

function insertInvChecks(
    ctx: InstrumentationContext,
    invExprs: Expression[],
    annotations: Annotation[],
    contract: ContractDefinition,
    body: Block,
    structLocalVar: VariableDeclaration,
    debugEventInfo: Array<[EventDefinition, EmitStatement] | undefined>
): Recipe {
    const factory = ctx.factory;

    const recipe: Recipe = [];

    for (let i = 0; i < invExprs.length; i++) {
        const predicate = invExprs[i];

        const event = getAssertionFailedEvent(factory, contract);
        const dbgInfo = debugEventInfo[i];
        const emitStmt = dbgInfo !== undefined ? dbgInfo[1] : undefined;
        const check = emitAssert(ctx, predicate, annotations[i], event, structLocalVar, emitStmt);

        recipe.push(new InsertStatement(factory, check, "end", body));
    }

    return recipe;
}

function insertAssignments(
    factory: ASTNodeFactory,
    assignments: Assignment[],
    body: Block,
    originalCall?: Statement
): Recipe {
    const recipe = [];

    const position = originalCall == undefined ? "end" : "before";

    for (const assignment of assignments) {
        recipe.push(
            new InsertStatement(
                factory,
                factory.makeExpressionStatement(assignment),
                position,
                body,
                originalCall
            )
        );
    }

    return recipe;
}

/**
 * Build the recipe for adding a temporary vars struct. This involves
 *  1) adding the struct defs to the contract
 *  2) adding the local var to the target function.
 *
 * @param ctx
 * @param result - instrumentation result result holding the the struct def and generated local struct var
 * @param contract - contract where we are adding the temporary var struct
 * @param body - body of the function where we are adding the struct def
 * @param originalCall
 */
function insertVarsStruct(
    ctx: InstrumentationContext,
    result: InstrumentationResult,
    contract: ContractDefinition,
    body: Block
): Recipe {
    const factory = ctx.factory;

    const localVarDecl = factory.makeVariableDeclarationStatement([], [result.structLocalVariable]);

    return [
        new InsertStructDef(factory, result.struct, contract),
        new InsertStatement(factory, localVarDecl, "start", body)
    ];
}

function getCheckStateInvsFuncs(contract: ContractDefinition): FunctionDefinition {
    return single(
        contract.vFunctions.filter(
            (fn) =>
                fn.name === CHECK_STATE_INVS_FUN || fn.name.slice(0, -2) === CHECK_STATE_INVS_FUN
        )
    );
}

function isPublic(fn: FunctionDefinition): boolean {
    return [FunctionVisibility.Default, FunctionVisibility.Public].includes(fn.visibility);
}

function getInternalCheckInvsFun(contract: ContractDefinition): string {
    const allNames = getAllNames(contract);
    const funcName = `__scribble_${contract.name}_check_state_invariants_internal`;
    if (!allNames.has(funcName)) {
        return funcName;
    }

    let idx = 0;
    while (allNames.has(`${funcName}_${idx}`)) {
        idx++;
    }

    return funcName;
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
        typing: TypeMap,
        semInfo: SemMap,
        annotations: Annotation[],
        contract: ContractDefinition
    ): void {
        const recipe: Recipe = [];

        const [internalInvChecker, internalCheckerRecipe] = this.makeInternalInvariantChecker(
            ctx,
            typing,
            semInfo,
            annotations,
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
            const path = relative(dirname(contract.vScope.absolutePath), utilsUnit.absolutePath);
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

        cook(recipe);
    }

    private hasImport(unit: SourceUnit, imported: SourceUnit): boolean {
        return (
            unit.vImportDirectives.filter((importD) => importD.vSourceUnit === imported).length > 0
        );
    }

    private makeInternalInvariantChecker(
        ctx: InstrumentationContext,
        typing: TypeMap,
        semInfo: SemMap,
        annotations: Annotation[],
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
            getInternalCheckInvsFun(contract),
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

        const instrResult = generateExpressions(
            annotations,
            ctx,
            typing,
            semInfo,
            contract,
            checker
        );

        assert(instrResult.oldAssignments.length === 0, ``);

        recipe.push(new InsertFunction(ctx.factory, contract, checker));

        if (instrResult.struct.vMembers.length > 0) {
            recipe.push(...insertVarsStruct(ctx, instrResult, contract, body));
        }

        assert(instrResult.oldAssignments.length === 0, ``);

        for (const dbgInfo of instrResult.debugEventsInfo) {
            if (dbgInfo !== undefined) {
                recipe.push(new InsertEvent(factory, contract, dbgInfo[0]));
            }
        }

        recipe.push(
            ...insertAssignments(factory, instrResult.newAssignments, body),
            ...insertInvChecks(
                ctx,
                instrResult.transpiledPredicates,
                annotations,
                contract,
                body,
                instrResult.structLocalVariable,
                instrResult.debugEventsInfo
            )
        );

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
        const namesInScope = getAllNames(contract);
        let funcName = CHECK_STATE_INVS_FUN;
        if (namesInScope.has(funcName)) {
            let idx = 1;
            while (namesInScope.has(`${funcName}_${idx}`)) {
                idx++;
            }

            funcName += `_${idx}`;
        }

        const mut = changesMutability(ctx)
            ? FunctionStateMutability.NonPayable
            : FunctionStateMutability.View;

        const checker = factory.makeFunctionDefinition(
            contract.id,
            FunctionKind.Function,
            funcName,
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
                    : factory.makeIdentifier("<missing>", getInternalCheckInvsFun(base), -1);

            const callInternalCheckInvs = factory.makeExpressionStatement(
                factory.makeFunctionCall("<missing>", FunctionCallKind.FunctionCall, callExpr, [])
            );

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

        recipe.push(
            new InsertStatement(
                factory,
                factory.makeExpressionStatement(
                    factory.makeAssignment(
                        "<missing>",
                        "=",
                        factory.makeIdentifier("bool", OUT_OF_CONTRACT, -1),
                        factory.makeLiteral("bool", LiteralKind.Bool, "", "false")
                    )
                ),
                "start",
                body
            ),
            new InsertStatement(
                factory,
                factory.makeExpressionStatement(
                    factory.makeFunctionCall(
                        "<missing>",
                        FunctionCallKind.FunctionCall,
                        factory.makeIdentifierFor(generalInvChecker),
                        []
                    )
                ),
                "end",
                body
            ),
            new InsertStatement(
                factory,
                factory.makeExpressionStatement(
                    factory.makeAssignment(
                        "<missing>",
                        "=",
                        factory.makeIdentifier("bool", OUT_OF_CONTRACT, -1),
                        factory.makeLiteral("bool", LiteralKind.Bool, "", "true")
                    )
                ),
                "end",
                body
            )
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

            const calleeType = parseType(callSite.vExpression.typeString);
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
                            factory.makeIdentifier("bool", OUT_OF_CONTRACT, -1),
                            factory.makeLiteral("bool", LiteralKind.Bool, "", "true")
                        )
                    )
                );
                wrapperBody.appendChild(
                    factory.makeExpressionStatement(
                        factory.makeAssignment(
                            "<missing>",
                            "=",
                            factory.makeIdentifier("bool", OUT_OF_CONTRACT, -1),
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
        typing: TypeMap,
        semInfo: SemMap,
        annotations: Annotation[],
        contract: ContractDefinition,
        fn: FunctionDefinition,
        needsContractInvInstr: boolean
    ): void {
        const factory = ctx.factory;
        const nameSet = getAllNames(contract);
        const varsInFunc = getNamesInFuncScope(contract, fn);
        const [interposeRecipe, stub] = interpose(fn, ctx, nameSet, varsInFunc);

        cook(interposeRecipe);

        const body = stub.vBody as Block;

        const originalCall = single(
            body.vStatements,
            `Expected stub block for ${stub.name} have a single statement (call to original function), not ${body.vStatements.length}`
        );

        const instrResult = generateExpressions(annotations, ctx, typing, semInfo, contract, stub);

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

        if (instrResult.struct.vMembers.length > 0 || (checkStateInvs && isPublic(stub))) {
            recipe.push(...insertVarsStruct(ctx, instrResult, contract, body));
        }

        for (const dbgInfo of instrResult.debugEventsInfo) {
            if (dbgInfo !== undefined) {
                recipe.push(new InsertEvent(factory, contract, dbgInfo[0]));
            }
        }

        if (checkStateInvs) {
            recipe.push(...this.insertEnterMarker(factory, instrResult, stub, originalCall));
        }

        recipe.push(
            ...insertAssignments(factory, instrResult.oldAssignments, body, originalCall),
            ...insertAssignments(factory, instrResult.newAssignments, body),
            ...insertInvChecks(
                ctx,
                instrResult.transpiledPredicates,
                annotations,
                contract,
                body,
                instrResult.structLocalVariable,
                instrResult.debugEventsInfo
            )
        );

        if (checkStateInvs) {
            recipe.push(...this.insertExitMarker(factory, instrResult, contract, stub));
        }

        cook(recipe);
    }

    private insertEnterMarker(
        factory: ASTNodeFactory,
        instrResult: InstrumentationResult,
        stub: FunctionDefinition,
        originalCall: Statement
    ): Recipe {
        const body = stub.vBody as Block;

        const recipe: Recipe = [];

        if (stub.visibility === FunctionVisibility.External) {
            const enter = factory.makeExpressionStatement(
                factory.makeAssignment(
                    "<missing>",
                    "=",
                    factory.makeIdentifier("<missing>", OUT_OF_CONTRACT, -1),
                    factory.makeLiteral("<missing>", LiteralKind.Bool, "", "false")
                )
            );

            recipe.push(new InsertStatement(factory, enter, "before", body, originalCall));
        } else if (isPublic(stub)) {
            instrResult.struct.appendChild(
                factory.makeVariableDeclaration(
                    false,
                    false,
                    CHECK_INVS_AT_END,
                    instrResult.struct.id,
                    false,
                    DataLocation.Default,
                    StateVariableVisibility.Default,
                    Mutability.Mutable,
                    "bool",
                    undefined,
                    factory.makeElementaryTypeName("<missing>", "bool")
                )
            );

            const storeEntry = factory.makeExpressionStatement(
                factory.makeAssignment(
                    "<missing>",
                    "=",
                    factory.makeMemberAccess(
                        "<missing>",
                        factory.makeIdentifierFor(instrResult.structLocalVariable),
                        CHECK_INVS_AT_END,
                        -1
                    ),
                    factory.makeIdentifier("<missing>", OUT_OF_CONTRACT, -1)
                )
            );

            recipe.push(new InsertStatement(factory, storeEntry, "before", body, originalCall));

            const enter = factory.makeExpressionStatement(
                factory.makeAssignment(
                    "<missing>",
                    "=",
                    factory.makeIdentifier("<missing>", OUT_OF_CONTRACT, -1),
                    factory.makeLiteral("<missing>", LiteralKind.Bool, "", "false")
                )
            );

            recipe.push(new InsertStatement(factory, enter, "before", body, originalCall));
        }

        return recipe;
    }

    private insertExitMarker(
        factory: ASTNodeFactory,
        instrResult: InstrumentationResult,
        contract: ContractDefinition,
        stub: FunctionDefinition
    ): Recipe {
        const body = stub.vBody as Block;

        const recipe: Recipe = [];

        const checkInvsCall = factory.makeExpressionStatement(
            factory.makeFunctionCall(
                "<missing>",
                FunctionCallKind.FunctionCall,
                factory.makeIdentifierFor(getCheckStateInvsFuncs(contract)),
                []
            )
        );

        if (isPublic(stub)) {
            const ifStmt = factory.makeIfStatement(
                factory.makeMemberAccess(
                    "bool",
                    factory.makeIdentifierFor(instrResult.structLocalVariable),
                    CHECK_INVS_AT_END,
                    -1
                ),
                checkInvsCall
            );

            recipe.push(new InsertStatement(factory, ifStmt, "end", body));
        } else {
            recipe.push(new InsertStatement(factory, checkInvsCall, "end", body));
        }

        const exit = factory.makeExpressionStatement(
            factory.makeAssignment(
                "<missing>",
                "=",
                factory.makeIdentifier("<missing>", OUT_OF_CONTRACT, -1),
                stub.visibility === FunctionVisibility.External
                    ? factory.makeLiteral("bool", LiteralKind.Bool, "", "true")
                    : factory.makeMemberAccess(
                          "bool",
                          factory.makeIdentifierFor(instrResult.structLocalVariable),
                          CHECK_INVS_AT_END,
                          -1
                      )
            )
        );

        recipe.push(new InsertStatement(factory, exit, "end", body));

        return recipe;
    }
}
