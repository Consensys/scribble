import {
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
    UncheckedBlock,
    TypeNode,
    FunctionType,
    getNodeType,
    FixedBytesType,
    PointerType,
    StringType,
    BytesType,
    IntType,
    BoolType,
    AddressType
} from "solc-typed-ast";
import { SId, SLet, SNode, AnnotationType } from "../spec-lang/ast";
import { StateVarScope, SemMap, TypeEnv } from "../spec-lang/tc";
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
import { InstrumentationContext } from "./instrumentation_context";
import { InstrumentationSiteType, TranspilingContext } from "./transpiling_context";

import { gte } from "semver";
import {
    filterByType,
    transpile,
    transpileAnnotation,
    transpileFunVarDecl,
    transpileType
} from "..";

export type SBinding = [string | string[], TypeNode, SNode, boolean];
export type SBindings = SBinding[];

/**
 * Base class for all instrumentation errors.
 */
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

/// Return true if the current instrumentation configuration requires
/// instrumented pure/view functions to become non-payable
export function changesMutability(ctx: InstrumentationContext): boolean {
    return ctx.assertionMode === "log";
}

/**
 * Find all external calls in the `ContractDfinition`/`FunctionDefinition` `node`.
 * Ignore any calls that were inserted by instrumentation (we tell those appart by their `<missing>` typeString).
 */
export function findExternalCalls(
    node: ContractDefinition | FunctionDefinition,
    version: string
): FunctionCall[] {
    const res: FunctionCall[] = [];

    for (const call of node.getChildrenByType(FunctionCall)) {
        if (call.kind !== FunctionCallKind.FunctionCall) {
            continue;
        }

        // Skip any calls we've added as part of instrumentation
        if (call.vExpression.typeString.includes("<missing>")) {
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
            const calleeType = getNodeType(call.vExpression, version);

            assert(
                calleeType instanceof FunctionType,
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

/**
 * Generate and return the `__scribble_reentrancyUtil` contract that
 * contains the out-of-contract flag.
 */
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

/**
 * Walk the given Scribble expression `n`, and build a set of all identifiers appearing inside
 * that are of interest for debugging purposes.
 */
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
                type instanceof AddressType ||
                type instanceof BoolType ||
                type instanceof FixedBytesType ||
                type instanceof IntType ||
                (type instanceof PointerType &&
                    (type.to instanceof StringType || type.to instanceof BytesType))
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

type DebugInfo = [EventDefinition, EmitStatement];

/**
 * Build a debug event/debug event emission statement for each of the provided `annotations`. Return
 * an array of the computed tuples `[EventDefinition, `EmitStatement`].
 *
 * If a given annotation doesn't have any identifiers to output for debugging purposes, return `undefined`
 * in that respective index.
 */
function getDebugInfo(
    annotations: PropertyMetaData[],
    transCtx: TranspilingContext
): Array<DebugInfo | undefined> {
    const res: Array<DebugInfo | undefined> = [];
    const factory = transCtx.factory;
    const instrCtx = transCtx.instrCtx;

    for (const annot of annotations) {
        const dbgIds = [...gatherDebugIds(annot.expression, transCtx.typeEnv)];

        if (dbgIds.length == 0) {
            res.push(undefined);
        } else {
            // Next construct the parameters for the event
            const evtParams = dbgIds.map((v) => {
                const vType = transCtx.typeEnv.typeOf(v);
                const type = transpileType(vType, transCtx.factory);
                const typeString = vType instanceof PointerType ? vType.to.pp() : vType.pp();

                return factory.makeVariableDeclaration(
                    false,
                    false,
                    v.name,
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

            // Get or construct the event definition
            let evtDef: EventDefinition;
            if (!instrCtx.debugEventDefs.has(annot.id)) {
                evtDef = factory.makeEventDefinition(
                    true,
                    `P${annot.id}Fail`,
                    factory.makeParameterList(evtParams)
                );

                instrCtx.debugEventDefs.set(annot.id, evtDef);
            } else {
                evtDef = instrCtx.debugEventDefs.get(annot.id) as EventDefinition;
            }

            const evtArgs = dbgIds.map((v) => transpile(v, transCtx));

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

            res.push([evtDef, emitStmt]);
        }
    }

    return res;
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

/**
 * Build the AST `Statement` that checks whether the provided `expr` is true, and
 * outputs an `AssertionFailed` event with the appropriate error otherwise.
 *
 * If a debug `emitStmt` is provided emit it upon failure too.
 */
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

/**
 * Return the `EventDefinition` for the 'AssertFailed` event. If such a
 * defintion is not declared in the current contract, or a parent contract,
 * build it and insert it under `contract`.
 */
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

function getCheckStateInvsFuncs(
    contract: ContractDefinition,
    ctx: InstrumentationContext
): FunctionDefinition {
    return single(contract.vFunctions.filter((fn) => fn.name === ctx.checkStateInvsFuncName));
}

function isPublic(fn: FunctionDefinition): boolean {
    return [FunctionVisibility.Default, FunctionVisibility.Public].includes(fn.visibility);
}

/**
 * Given a list of `PropertyMetaData` `annotations` and a `TranspilingContext` `ctx`,
 * transpile all the `annotations`, generate the checks for each one, and insert them in `ctx.container`.
 */
export function insertAnnotations(annotations: PropertyMetaData[], ctx: TranspilingContext): void {
    const factory = ctx.factory;
    const contract = ctx.container.vScope as ContractDefinition;
    const predicates: Array<[PropertyMetaData, Expression]> = [];

    for (const annotation of annotations) {
        predicates.push([annotation, transpileAnnotation(annotation, ctx)]);
    }

    const debugInfos = ctx.instrCtx.debugEvents ? getDebugInfo(annotations, ctx) : [];

    const checkStmts: Statement[] = predicates.map(([annotation, predicate], i) => {
        const event = getAssertionFailedEvent(factory, contract);
        const dbgInfo = debugInfos[i];
        const emitStmt = dbgInfo !== undefined ? dbgInfo[1] : undefined;
        return emitAssert(ctx, predicate, annotation, event, emitStmt);
    });

    for (const check of checkStmts) {
        ctx.insertStatement(check, false);
    }

    for (const dbgInfo of debugInfos) {
        if (dbgInfo !== undefined && dbgInfo[0].parent === undefined) {
            contract.appendChild(dbgInfo[0]);
        }
    }
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
        const typeEnv = ctx.typeEnv;
        const semInfo = ctx.semMap;

        const userFunctionsAnnotations = filterByType(annotations, UserFunctionDefinitionMetaData);

        this.makeUserFunctions(ctx, typeEnv, semInfo, userFunctionsAnnotations, contract);

        const propertyAnnotations = filterByType(annotations, PropertyMetaData).filter(
            (annot) => annot.type !== AnnotationType.IfSucceeds
        );

        if (needsStateInvChecks) {
            const internalInvChecker = this.makeInternalInvariantChecker(
                ctx,
                typeEnv,
                semInfo,
                propertyAnnotations,
                contract
            );

            const generalInvChecker = this.makeGeneralInvariantChecker(
                ctx,
                contract,
                internalInvChecker
            );

            this.prependBase(contract, ctx.utilsContract, ctx.factory);
            this.instrumentConstructor(ctx, contract, generalInvChecker);
            this.replaceExternalCallSites(ctx, contract, generalInvChecker);

            ctx.needsUtils(contract.vScope);
        }
    }

    private prependBase(
        contract: ContractDefinition,
        newBase: ContractDefinition,
        factory: ASTNodeFactory
    ): void {
        const inhSpec = factory.makeInheritanceSpecifier(
            factory.makeUserDefinedTypeName("<missing>", newBase.name, newBase.id),
            []
        );
        contract.linearizedBaseContracts.unshift(newBase.id);

        const specs = contract.vInheritanceSpecifiers;

        if (specs.length !== 0) {
            contract.insertBefore(inhSpec, specs[0]);
        } else {
            contract.appendChild(inhSpec);
        }
    }

    /**
     * Genrate and insert all the user-defined functions in `annotations` to the current
     * contract `contract`. Returns a list of the newly transpiler user-functions.
     */
    private makeUserFunctions(
        ctx: InstrumentationContext,
        typeEnv: TypeEnv,
        semInfo: SemMap,
        annotations: UserFunctionDefinitionMetaData[],
        contract: ContractDefinition
    ): FunctionDefinition[] {
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

            const transCtx = ctx.getTranspilingCtx(
                userFun,
                InstrumentationSiteType.UserDefinedFunction
            );

            for (let i = 0; i < funDef.parameters.length; i++) {
                const [, paramType] = funDef.parameters[i];
                const instrName = transCtx.getUserFunArg(funDef, i);
                userFun.vParameters.appendChild(
                    transpileFunVarDecl(instrName, paramType, transCtx)
                );
            }

            const retDecl = transpileFunVarDecl("", funDef.returnType, transCtx);
            userFun.vReturnParameters.appendChild(retDecl);
            ctx.addGeneralInstrumentation(retDecl);

            const result = transpileAnnotation(funDefMD, transCtx);
            body.appendChild(factory.makeReturn(userFun.vReturnParameters.id, result));

            ctx.addGeneralInstrumentation(body);
            contract.appendChild(userFun);
            userFuns.push(userFun);
        }

        return userFuns;
    }

    /**
     * Make the "internal invariant checker" function. For example given a
     * contract `C` with contract-wide invariants [I1, I2], the "internal
     * invariant checker" function is responsible ONLY for checking `I1` and
     * `I2`, but NOT for any of the invariants of base contracts.
     */
    private makeInternalInvariantChecker(
        ctx: InstrumentationContext,
        typeEnv: TypeEnv,
        semInfo: SemMap,
        annotations: PropertyMetaData[],
        contract: ContractDefinition
    ): FunctionDefinition {
        const factory = ctx.factory;

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

        const transCtx = ctx.getTranspilingCtx(checker, InstrumentationSiteType.ContractInvariant);
        insertAnnotations(annotations, transCtx);
        contract.appendChild(checker);

        return checker;
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
    ): FunctionDefinition {
        const factory = ctx.factory;
        const directBases = (ctx.cha.parents.get(contract) as ContractDefinition[])?.filter(
            (base) =>
                base.kind === ContractKind.Contract &&
                base !== ctx.utilsContract &&
                base !== contract
        );
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

        contract.appendChild(checker);

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
            body.appendChild(callInternalCheckInvs);
        }

        return checker;
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
    ): void {
        const factory = ctx.factory;

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

            contract.appendChild(constructor);
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

        body.insertAtBeginning(entryGuard);
        body.appendChild(callCheckInvs);
        body.appendChild(exitGuard);
    }

    /**
     * Wrap all external call sites in `contract` with wrappers that also invoke the
     * `generalInvChecker` function, to check contract invariants before leaving the contract.
     */
    private replaceExternalCallSites(
        ctx: InstrumentationContext,
        contract: ContractDefinition,
        generalInvChecker: FunctionDefinition
    ): void {
        const factory = ctx.factory;

        for (const callSite of findExternalCalls(contract, ctx.compilerVersion)) {
            const containingFun = callSite.getClosestParentByType(FunctionDefinition);

            if (
                containingFun !== undefined &&
                [FunctionKind.Fallback, FunctionKind.Receive].includes(containingFun.kind)
            ) {
                // Cannot instrument receive() and fallback()
                continue;
            }

            const calleeType = getNodeType(callSite.vExpression, ctx.compilerVersion);
            assert(
                calleeType instanceof FunctionType,
                `Expected function type not ${calleeType.pp()} for calee in ${callSite.print()}`
            );

            if (calleeType.mutability === FunctionStateMutability.Pure) {
                continue;
            }

            const callsiteWrapper = interposeCall(ctx, contract, callSite);

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
        }
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
        const annotations = filterByType(allAnnotations, PropertyMetaData);
        assert(
            allAnnotations.length === annotations.length,
            `NYI: Non-property annotations on functions.`
        );

        const stub = interpose(fn, ctx);
        const transCtx = ctx.getTranspilingCtx(stub, InstrumentationSiteType.FunctionAnnotation);
        insertAnnotations(annotations, transCtx);

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

        if (checkStateInvs) {
            this.insertEnterMarker(stub, transCtx);
            this.insertExitMarker(stub, transCtx);
        }
    }

    /**
     * For public/external functions insert a peramble that set the "out-of-contract" flag to false (marking that we are executing in the contract).
     * When the function is public, we remember the old value of the "out-of-contract" flag and restore it upon exit. This is done since
     * public function can also be invoked internally.
     */
    private insertEnterMarker(stub: FunctionDefinition, transCtx: TranspilingContext): void {
        const body = stub.vBody as Block;
        const factory = transCtx.factory;
        const instrCtx = transCtx.instrCtx;

        const stmts: Statement[] = [];

        if (stub.visibility === FunctionVisibility.External) {
            const enter = factory.makeExpressionStatement(
                factory.makeAssignment(
                    "<missing>",
                    "=",
                    factory.makeIdentifier("<missing>", instrCtx.outOfContractFlagName, -1),
                    factory.makeLiteral("<missing>", LiteralKind.Bool, "", "false")
                )
            );

            stmts.push(enter);
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

            const enter = factory.makeExpressionStatement(
                factory.makeAssignment(
                    "<missing>",
                    "=",
                    factory.makeIdentifier("<missing>", instrCtx.outOfContractFlagName, -1),
                    factory.makeLiteral("<missing>", LiteralKind.Bool, "", "false")
                )
            );

            stmts.push(storeEntry, enter);
        }

        const before: Statement | undefined =
            body.vStatements.length > 0 ? body.vStatements[0] : undefined;

        for (const stmt of stmts) {
            instrCtx.addGeneralInstrumentation(stmt);

            if (before) {
                body.insertBefore(stmt, before);
            } else {
                body.appendChild(stmt);
            }
        }
    }

    /**
     * For public/external functions insert a epilgoue that sets the "out-of-contract" flag(marking that we are executing in the contract).
     * When the function is public, we remember the old value of the "out-of-contract" flag and restore it upon exit. This is done since
     * public function can also be invoked internally.
     *
     * When the function is external we just set the flag to true.
     */
    private insertExitMarker(stub: FunctionDefinition, transCtx: TranspilingContext): void {
        const factory = transCtx.factory;
        const instrCtx = transCtx.instrCtx;
        const body = stub.vBody as Block;
        const contract = stub.vScope as ContractDefinition;
        const stmts: Statement[] = [];

        const checkInvsCall = factory.makeExpressionStatement(
            factory.makeFunctionCall(
                "<missing>",
                FunctionCallKind.FunctionCall,
                factory.makeIdentifierFor(getCheckStateInvsFuncs(contract, instrCtx)),
                []
            )
        );

        // Call the check contract invariants function (optional for public functions)
        if (isPublic(stub)) {
            stmts.push(
                factory.makeIfStatement(transCtx.refBinding(instrCtx.checkInvsFlag), checkInvsCall)
            );
        } else {
            stmts.push(checkInvsCall);
        }

        // Set re-entrancy flag
        stmts.push(
            factory.makeExpressionStatement(
                factory.makeAssignment(
                    "<missing>",
                    "=",
                    factory.makeIdentifier("<missing>", instrCtx.outOfContractFlagName, -1),
                    stub.visibility === FunctionVisibility.External
                        ? factory.makeLiteral("bool", LiteralKind.Bool, "", "true")
                        : transCtx.refBinding(instrCtx.checkInvsFlag)
                )
            )
        );

        for (const stmt of stmts) {
            instrCtx.addGeneralInstrumentation(stmt);
            body.appendChild(stmt);
        }
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
