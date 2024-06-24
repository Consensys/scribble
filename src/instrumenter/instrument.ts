import { gt, gte } from "semver";
import {
    ASTNode,
    ASTNodeFactory,
    AddressType,
    ArrayType,
    Block,
    BoolType,
    BuiltinFunctionType,
    BytesType,
    ContractDefinition,
    ContractKind,
    DataLocation,
    Expression,
    ExternalReferenceType,
    FixedBytesType,
    FunctionCall,
    FunctionCallKind,
    FunctionDefinition,
    FunctionKind,
    FunctionStateMutability,
    FunctionType,
    FunctionVisibility,
    InferType,
    IntLiteralType,
    IntType,
    Literal,
    LiteralKind,
    Mutability,
    OverrideSpecifier,
    PointerType,
    SourceUnit,
    StateVariableVisibility,
    Statement,
    StatementWithChildren,
    StringLiteralType,
    StringType,
    TryStatement,
    TypeName,
    TypeNode,
    UncheckedBlock,
    VariableDeclaration,
    assert
} from "solc-typed-ast";
import { AnnotationType, SLetAnnotation, SNode } from "../spec-lang/ast";
import {
    PPAbleError,
    SourceMap,
    filterByType,
    isASCII,
    isChangingState,
    isExternallyVisible,
    parseSrcTriple,
    print,
    rangeToLocRange,
    single
} from "../util";
import {
    AnnotationMap,
    AnnotationMetaData,
    PropertyMetaData,
    TryAnnotationMetaData,
    UserConstantDefinitionMetaData,
    UserFunctionDefinitionMetaData
} from "./annotations";
import { InstrumentationContext } from "./instrumentation_context";
import { interpose, interposeCall } from "./interpose";
import { ensureStmtInBlock } from "./state_var_instrumenter";
import { transpileAnnotation, transpileType } from "./transpile";
import { InstrumentationSiteType, TranspilingContext } from "./transpiling_context";
import { getTypeDesc, getTypeLocation } from "./utils";

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

    constructor(msg: string, unsupportedNode: ASTNode, files: SourceMap) {
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
 * Find all external calls in the `ContractDefinition`/`FunctionDefinition` `node`.
 * Ignore any calls that were inserted by instrumentation (we tell those appart by their `<missing>` typeString).
 */
export function findExternalCalls(
    node: ContractDefinition | FunctionDefinition,
    inference: InferType
): FunctionCall[] {
    const interestingExternalCallBuiltins = ["call", "delegatecall", "staticcall"];

    return node.getChildrenBySelector(
        (node) =>
            node instanceof FunctionCall &&
            node.vExpression.typeString !== "<missing>" &&
            inference.isFunctionCallExternal(node) &&
            (node.vFunctionCallType === ExternalReferenceType.UserDefined ||
                interestingExternalCallBuiltins.includes(node.vFunctionName))
    );
}

/**
 * Build a debug event and debug event emission statement for the provided
 * `annotation`. Return a tuple `[EventDefinition, EmitStatement]`.
 *
 * If the given annotation doesn't have any identifiers to output for debugging
 * purposes, return `undefined`.
 */
function getDebugInfoEmit(
    annotation: PropertyMetaData | TryAnnotationMetaData,
    transCtx: TranspilingContext
): Statement | Statement[] | undefined {
    const factory = transCtx.factory;
    const instrCtx = transCtx.instrCtx;
    const inference = instrCtx.typeEnv.inference;

    const dbgIdsMap = transCtx.annotationDebugMap.get(annotation);

    // If there are no debug ids for the current annotation, there is no debug event to build
    if (dbgIdsMap.size() == 0) {
        return undefined;
    }

    const evtArgs: Expression[] = [...dbgIdsMap.values()].map((v) => v[1]);

    if (!instrCtx.debugEventsDescMap.has(annotation)) {
        instrCtx.debugEventsDescMap.set(
            annotation,
            [...dbgIdsMap.values()].map((v) => [v[0], v[2]])
        );
    }

    // Finally construct the emit statement for the debug event.
    if (instrCtx.assertionMode === "hardhat") {
        const emitStmts: Statement[] = [];

        const encoderVersion = inference.getUnitLevelAbiEncoderVersion(annotation.target);

        for (let expr of evtArgs) {
            const exprT = inference.typeOf(expr);

            let logFunc = getHardHatLogFuncName(exprT);

            if (logFunc === undefined) {
                assert(
                    inference.isABIEncodable(exprT, encoderVersion),
                    "Can not wrap {0} of type {1} with abi.encode() - type is not encodable",
                    expr,
                    exprT
                );

                expr = factory.abiEncode(expr);
                logFunc = "logBytes";
            }

            emitStmts.push(
                makeHardHatConsoleLogCall(instrCtx, annotation, expr, logFunc),
                makeHardHatConsoleLogCall(
                    instrCtx,
                    annotation,
                    factory.makeLiteral("str", LiteralKind.String, "", print(expr))
                )
            );
        }

        return emitStmts.length === 0 ? undefined : emitStmts;
    }

    const assertionFailedDataExpr = gt(instrCtx.compilerVersion, "0.6.2")
        ? instrCtx.getAssertionFailedDataEvent(annotation.target)
        : instrCtx.getAssertionFailedDataFun(annotation.target);

    const emitStmt = makeEmitStmt(instrCtx, assertionFailedDataExpr, [
        factory.makeLiteral("int", LiteralKind.Number, "", String(annotation.id)),
        factory.abiEncode(...evtArgs)
    ]);

    return emitStmt;
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
 * Returns `log*` function name from HardHat console, that supports passed `type`.
 * Returns `undefined` if none of the `log*` functions fit.
 *
 * @see https://hardhat.org/hardhat-network/docs/reference#console.log
 * @see https://github.com/NomicFoundation/hardhat/blob/main/packages/hardhat-core/console.sol
 */
function getHardHatLogFuncName(type: TypeNode): string | undefined {
    if (type instanceof BoolType) {
        return "logBool";
    }

    if (type instanceof AddressType) {
        return "logAddress";
    }

    if (type instanceof StringLiteralType) {
        return type.isHex ? "logBytes" : "logString";
    }

    if (type instanceof FixedBytesType) {
        return "logBytes" + type.size;
    }

    if (type instanceof IntLiteralType) {
        const fitT = type.smallestFittingType();

        assert(fitT !== undefined, "Unable to compute fitting type for {0}", type);

        type = fitT;
    }

    if (type instanceof IntType) {
        return type.signed ? "logInt" : "logUint";
    }

    if (type instanceof PointerType) {
        if (type.to instanceof StringType) {
            return "logString";
        }

        if (type.to instanceof BytesType) {
            return "logBytes";
        }
    }

    return undefined;
}

function makeHardHatConsoleLogCall(
    ctx: InstrumentationContext,
    annotation: PropertyMetaData | TryAnnotationMetaData,
    arg: Expression,
    logFunc?: string
): Statement {
    const unit = annotation.target.getClosestParentByType(SourceUnit);
    const factory = ctx.factory;

    assert(
        unit !== undefined,
        "Unable to locate source unit for annotation {0}",
        annotation.parsedAnnot
    );

    ctx.needsImport(unit, "hardhat/console.sol");

    if (logFunc === undefined) {
        const argT = ctx.typeEnv.inference.typeOf(arg);

        logFunc = getHardHatLogFuncName(argT);
    }

    assert(logFunc !== undefined, "Unable to pick specific log function for {0}", arg);

    return factory.makeExpressionStatement(
        factory.makeFunctionCall(
            "<missing>",
            FunctionCallKind.FunctionCall,
            factory.makeMemberAccess(
                "<missing>",
                factory.makeIdentifier("<missing>", "console", -1),
                logFunc,
                -1
            ),
            [arg]
        )
    );
}

function makeEmitStmt(
    ctx: InstrumentationContext,
    eventExpr: Expression,
    args: Expression[]
): Statement {
    const factory = ctx.factory;

    const callStmt = factory.makeFunctionCall(
        "<missing>",
        FunctionCallKind.FunctionCall,
        eventExpr,
        args
    );

    // For solidity > 0.6.2 directly emit the event in place
    if (gt(ctx.compilerVersion, "0.6.2")) {
        return factory.makeEmitStatement(callStmt);
    }

    // For solidity older than 0.6.2 perform a function call on the library
    return factory.makeExpressionStatement(callStmt);
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
    annotation: PropertyMetaData | TryAnnotationMetaData,
    contract: ContractDefinition,
    emitStmt?: Statement | Statement[]
): Statement {
    const instrCtx = transCtx.instrCtx;
    const factory = instrCtx.factory;

    let userAssertFailed: Statement;
    let userAssertionHit: Statement | undefined;

    const messageStr = `000000:0000:000 ${annotation.id}: ${annotation.message}`;
    const litKind = isASCII(annotation.message) ? LiteralKind.String : LiteralKind.UnicodeString;
    const messageLit = factory.makeLiteral("<missing>", litKind, "", messageStr);
    const hitLit = factory.makeLiteral("<missing>", litKind, "", `HIT: ${messageStr}`);

    if (instrCtx.assertionMode === "log") {
        const event = gt(instrCtx.compilerVersion, "0.6.2")
            ? instrCtx.getAssertionFailedEvent(contract)
            : instrCtx.getAssertionFailedFun(contract);

        userAssertFailed = makeEmitStmt(instrCtx, event, [messageLit]);

        instrCtx.addStringLiteralToAdjust(messageLit, userAssertFailed);

        if (instrCtx.covAssertions) {
            userAssertionHit = makeEmitStmt(instrCtx, event, [hitLit]);

            instrCtx.addStringLiteralToAdjust(hitLit, userAssertFailed);
        }
    } else if (instrCtx.assertionMode === "hardhat") {
        userAssertFailed = makeHardHatConsoleLogCall(instrCtx, annotation, messageLit);

        instrCtx.addStringLiteralToAdjust(messageLit, userAssertFailed);

        if (instrCtx.covAssertions) {
            userAssertionHit = makeHardHatConsoleLogCall(instrCtx, annotation, hitLit);

            instrCtx.addStringLiteralToAdjust(hitLit, userAssertFailed);
        }
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

        if (instrCtx.covAssertions) {
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
    }

    const ifBody: Statement[] = [userAssertFailed];

    if (emitStmt) {
        if (!(emitStmt instanceof Array)) {
            emitStmt = [emitStmt];
        }

        for (const stmt of emitStmt) {
            instrCtx.addAnnotationInstrumentation(annotation, stmt);

            ifBody.unshift(stmt);
        }
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
export function insertAnnotations(
    annotations: Array<PropertyMetaData | TryAnnotationMetaData>,
    ctx: TranspilingContext
): void {
    const factory = ctx.factory;
    const contract = ctx.containerContract;
    const instrCtx = ctx.instrCtx;

    // Re-sort the annotations so that #try and #require are always instrumented first.
    // This makes sure they are hit before any old() statements in subsequent properties,
    // that the fuzzer may get stuck on.
    const isTryOrReq = (md: any) =>
        md instanceof TryAnnotationMetaData ||
        (md instanceof PropertyMetaData && md.type === AnnotationType.Require);

    const sortedAnnotations = [
        ...annotations.filter((md) => isTryOrReq(md)),
        ...annotations.filter((md) => !isTryOrReq(md))
    ];

    for (let i = 0; i < sortedAnnotations.length; i++) {
        const annotation = sortedAnnotations[i];
        const predicate = transpileAnnotation(annotation, ctx);

        let check: Statement | Statement[];
        let isOld: boolean;

        // Note: we don't emit assertion failed debug events in mstore mode, as that
        // defeats the purpose of mstore mode (to not emit additional events to
        // preserve interface compatibility)
        const emitStmt =
            instrCtx.debugEvents && instrCtx.assertionMode !== "mstore"
                ? getDebugInfoEmit(annotation, ctx)
                : undefined;

        const targetIsStmt =
            annotation.target instanceof Statement ||
            annotation.target instanceof StatementWithChildren;

        if (annotation.type === AnnotationType.Require) {
            assert(
                predicate instanceof Expression,
                `Annotation type "${annotation.type}" expected single expression (got array)`
            );

            const reqStmt = factory.makeExpressionStatement(
                factory.makeFunctionCall(
                    "<missing>",
                    FunctionCallKind.FunctionCall,
                    factory.makeIdentifier("<missing>", "require", -1),
                    [predicate]
                )
            );

            instrCtx.addAnnotationInstrumentation(annotation, reqStmt);
            instrCtx.addAnnotationCheck(annotation, predicate);

            check = reqStmt;
            isOld = !targetIsStmt;
        } else if (annotation.type === AnnotationType.Try) {
            assert(
                predicate instanceof Array,
                `Annotation type "${annotation.type}" expected array of expressions (got expression instance)`
            );

            if (!ctx.hasBinding(ctx.instrCtx.scratchField)) {
                ctx.addBinding(
                    ctx.instrCtx.scratchField,
                    factory.makeElementaryTypeName("<missing>", "uint256")
                );
            }

            check = predicate.map((expr) => {
                const lhs = ctx.refBinding(ctx.instrCtx.scratchField);
                const scratchAssign = factory.makeExpressionStatement(
                    factory.makeAssignment(
                        "<missing>",
                        "=",
                        lhs,
                        factory.makeLiteral("uint256", LiteralKind.Number, "", "42")
                    )
                );

                const stmt = factory.makeIfStatement(expr, scratchAssign);

                instrCtx.addAnnotationInstrumentation(annotation, stmt);
                instrCtx.addAnnotationCheck(annotation, expr);

                return stmt;
            });
            isOld = !targetIsStmt;
        } else if (annotation.type === AnnotationType.LetAnnotation) {
            assert(
                predicate instanceof Expression,
                `Annotation type "${annotation.type}" expected single expression (got array)`
            );

            const parsedAnnot = annotation.parsedAnnot as SLetAnnotation;
            const name = ctx.getLetAnnotationBinding(parsedAnnot);
            const stmt = factory.makeAssignment("<missing>", "=", ctx.refBinding(name), predicate);

            /// For now keep #let annotations as 'general' annotation, as to not
            /// confuse consumers of the instrumentation metadata (they only
            /// expect actual "check" annotations). This however is hacky.
            /// TODO: Separate src mapping information for all annotations as a separate entity in metadata
            instrCtx.addGeneralInstrumentation(stmt);

            check = stmt;
            isOld = false;
        } else {
            assert(
                predicate instanceof Expression,
                `Annotation type "${annotation.type}" expected single expression (got array)`
            );

            check = emitAssert(ctx, predicate, annotation, contract, emitStmt);
            isOld = false;
        }

        if (check instanceof Array) {
            for (const stmt of check) {
                ctx.insertStatement(stmt, isOld);
            }
        } else {
            ctx.insertStatement(check, isOld);
        }
    }
}

/**
 * Instrument the contract  `contract` with checks for the contract-level invariants in `annotations`.
 * Note that this only emits the functions for checking the contracts.
 * Interposing on the public/external functions in `contract`,
 * incrementing/decrementing the stack depth,
 * and calling the invariant checkers is done in `instrumentFunction()`.
 *
 * Interposing on the external callsites, is done in `interposeCall`.
 */
export function instrumentContract(
    ctx: InstrumentationContext,
    annotMap: AnnotationMap,
    annotations: AnnotationMetaData[],
    contract: ContractDefinition,
    needsStateInvChecks: boolean
): void {
    const userFunctionsAnnotations = filterByType(annotations, UserFunctionDefinitionMetaData);

    makeUserFunctions(ctx, userFunctionsAnnotations, contract);

    const userConstantAnnotations = filterByType(annotations, UserConstantDefinitionMetaData);

    const propertyAnnotations = filterByType(annotations, PropertyMetaData).filter(
        (annot) => annot.type !== AnnotationType.IfSucceeds
    );

    if (userConstantAnnotations.length > 0) {
        makeUserConstants(ctx, contract, userConstantAnnotations);
    }

    if (needsStateInvChecks) {
        const internalInvChecker = makeInternalInvariantChecker(ctx, propertyAnnotations, contract);
        const generalInvChecker = makeGeneralInvariantChecker(ctx, contract, internalInvChecker);

        let needInstrumentingCtr = true;

        /**
         * Skip instrumenting the constructor
         * if there are any annotations that are attached to it.
         *
         * In that case it would be instrumented by a common logic
         * and does not require special handling.
         */
        const ctr = contract.vConstructor;

        if (ctr) {
            const ctrAnnots = annotMap.get(ctr);

            needInstrumentingCtr = ctrAnnots === undefined || ctrAnnots.length === 0;
        }

        if (needInstrumentingCtr) {
            instrumentConstructor(ctx, contract, generalInvChecker);
        }

        replaceExternalCallSites(ctx, contract, generalInvChecker);
    }
}

/**
 * Generate and insert all the user-defined functions in `annotations` to the current
 * contract `contract`. Returns a list of the newly transpiler user-functions.
 */
function makeUserFunctions(
    ctx: InstrumentationContext,
    annotations: UserFunctionDefinitionMetaData[],
    contract: ContractDefinition
): FunctionDefinition[] {
    const userFuns: FunctionDefinition[] = [];

    const factory = ctx.factory;
    const nameGen = ctx.nameGenerator;

    for (const funDefMD of annotations) {
        const funDef = funDefMD.parsedAnnot;
        const userFun = factory.addEmptyFun(
            ctx,
            nameGen.getFresh(funDef.name.name, true),
            FunctionVisibility.Internal,
            contract
        );

        userFun.stateMutability = FunctionStateMutability.View;
        userFun.documentation = `Implementation of user function ${funDef.pp()}`;

        ctx.userFunctions.set(funDef, userFun);

        /**
         * Arithmetic in Solidity >= 0.8.0 is checked by default.
         * In Scribble its unchecked.
         */
        const body = gte(ctx.compilerVersion, "0.8.0")
            ? (factory.addStmt(userFun, factory.makeUncheckedBlock([])) as UncheckedBlock)
            : (userFun.vBody as Block);

        const transCtx = ctx.transCtxMap.get(userFun, InstrumentationSiteType.SinglePointWrapper);

        for (let i = 0; i < funDef.parameters.length; i++) {
            const [, paramType] = funDef.parameters[i];
            const instrName = transCtx.getUserFunArg(funDef, i);

            factory.addFunArg(instrName, paramType, getTypeLocation(paramType), userFun);
        }

        factory.addFunRet(ctx, "", funDef.returnType, getTypeLocation(funDef.returnType), userFun);

        const result = transpileAnnotation(funDefMD, transCtx);

        assert(result instanceof Expression, `Expected single expression (got array)`);

        factory.addStmt(body, factory.makeReturn(userFun.vReturnParameters.id, result));

        userFuns.push(userFun);
    }

    return userFuns;
}

function makeUserConstants(
    ctx: InstrumentationContext,
    contract: ContractDefinition,
    annotations: UserConstantDefinitionMetaData[]
): VariableDeclaration[] {
    const userConsts: VariableDeclaration[] = [];

    if (annotations.length === 0) {
        return userConsts;
    }

    const factory = ctx.factory;
    const nameGen = ctx.nameGenerator;

    const ctor = factory.getOrAddConstructor(contract);
    const ctorBody = ctor.vBody as Block;

    for (const constDefMd of annotations) {
        const constDef = constDefMd.parsedAnnot;
        const constType = constDef.formalType;

        const userConst = factory.makeVariableDeclaration(
            true,
            false,
            nameGen.getFresh(`${constDef.name.name}_${constDefMd.target.id}_`),
            contract.id,
            true,
            getTypeLocation(constType),
            StateVariableVisibility.Internal,
            Mutability.Mutable,
            "<missing>",
            `Definition of user constant ${constDef.pp()}`,
            constType instanceof TypeName ? constType : transpileType(constType, factory)
        );

        ctx.userConstants.set(constDef, userConst);

        const transCtx = ctx.transCtxMap.get(ctor, InstrumentationSiteType.Custom);

        const constValue = transpileAnnotation(constDefMd, transCtx);

        assert(constValue instanceof Expression, `Expected single expression (got array)`);

        contract.appendChild(userConst);

        const stmtAssignValue = factory.makeExpressionStatement(
            factory.makeAssignment(
                "<missing>",
                "=",
                factory.makeIdentifierFor(userConst),
                constValue
            ),
            `Value assignment for ${constDef.pp()}`
        );

        ctorBody.appendChild(stmtAssignValue);

        ctx.addGeneralInstrumentation(userConst, stmtAssignValue);

        userConsts.push(userConst);
    }

    return userConsts;
}

/**
 * Make the "internal invariant checker" function. For example given a
 * contract `C` with contract-wide invariants [I1, I2], the "internal
 * invariant checker" function is responsible ONLY for checking `I1` and
 * `I2`, but NOT for any of the invariants of base contracts.
 */
function makeInternalInvariantChecker(
    ctx: InstrumentationContext,
    annotations: PropertyMetaData[],
    contract: ContractDefinition
): FunctionDefinition {
    const factory = ctx.factory;

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
        factory.makeBlock([]),
        factory.makeStructuredDocumentation(`Check only the current contract's state invariants`)
    );

    const transCtx = ctx.transCtxMap.get(checker, InstrumentationSiteType.SinglePointWrapper);

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
 */
function makeGeneralInvariantChecker(
    ctx: InstrumentationContext,
    contract: ContractDefinition,
    internalInvChecker: FunctionDefinition
): FunctionDefinition {
    const factory = ctx.factory;
    const directBases = (ctx.cha.parents.get(contract) as ContractDefinition[])?.filter(
        (base) => base.kind === ContractKind.Contract && base !== contract
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
        /// Skip the utils contract and any interface bases
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

        factory.addStmt(body, callInternalCheckInvs);
    }

    return checker;
}

/**
 * Contract invariants need to be checked at the end of the constructor.
 * If there is no constructor insert a default constructor.
 */
function instrumentConstructor(
    ctx: InstrumentationContext,
    contract: ContractDefinition,
    generalInvChecker: FunctionDefinition
): void {
    const factory = ctx.factory;

    const constructor = factory.getOrAddConstructor(contract);
    const body = constructor.vBody as Block;

    const entryGuard = factory.makeExpressionStatement(
        ctx.setInContract(constructor, factory.makeLiteral("bool", LiteralKind.Bool, "", "true"))
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
        ctx.setInContract(constructor, factory.makeLiteral("bool", LiteralKind.Bool, "", "false"))
    );

    ctx.addGeneralInstrumentation(entryGuard, callCheckInvs, exitGuard);

    body.insertAtBeginning(entryGuard);
    body.appendChild(callCheckInvs);
    body.appendChild(exitGuard);
}

/**
 * Given a `TryStatement` `tryStmt` insert the neccessary code around the
 * try statement to check that the contract invariant is re-established before the external
 * call in the try statement, and to keep track of whether we are in or out of the contract.
 */
function instrumentTryCallsite(
    ctx: InstrumentationContext,
    tryStmt: TryStatement,
    generalInvChecker: FunctionDefinition
): void {
    const factory = ctx.factory;
    ensureStmtInBlock(tryStmt, factory);

    const block = tryStmt.parent as Block;

    const callInvCheckerStmt = factory.makeExpressionStatement(
        factory.makeFunctionCall(
            "<missing>",
            FunctionCallKind.FunctionCall,
            factory.makeIdentifierFor(generalInvChecker),
            []
        )
    );

    block.insertBefore(callInvCheckerStmt, tryStmt);

    const callee = tryStmt.vExternalCall.vReferencedDeclaration;
    const calleeMutable = !(callee instanceof FunctionDefinition) || isChangingState(callee);

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
    if (calleeMutable) {
        block.insertBefore(
            factory.makeExpressionStatement(
                ctx.setInContract(
                    tryStmt,
                    factory.makeLiteral("bool", LiteralKind.Bool, "", "false")
                )
            ),
            tryStmt
        );

        for (const clause of tryStmt.vClauses) {
            clause.vBlock.insertAtBeginning(
                factory.makeExpressionStatement(
                    ctx.setInContract(
                        tryStmt,
                        factory.makeLiteral("bool", LiteralKind.Bool, "", "true")
                    )
                )
            );
        }
    }
}

/**
 * Wrap all external call sites in `contract` with wrappers that also invoke the
 * `generalInvChecker` function, to check contract invariants before leaving the contract.
 */
function replaceExternalCallSites(
    ctx: InstrumentationContext,
    contract: ContractDefinition,
    generalInvChecker: FunctionDefinition
): void {
    const factory = ctx.factory;

    for (const callSite of findExternalCalls(contract, ctx.typeEnv.inference)) {
        const containingFun = callSite.getClosestParentByType(FunctionDefinition);

        if (
            containingFun !== undefined &&
            [FunctionKind.Fallback, FunctionKind.Receive].includes(containingFun.kind)
        ) {
            // Cannot instrument receive() and fallback()
            continue;
        }

        const calleeType = ctx.typeEnv.inference.typeOfCallee(callSite);

        assert(
            calleeType instanceof FunctionType || calleeType instanceof BuiltinFunctionType,
            "Expected function type not {0} for callee in {1}",
            calleeType,
            callSite
        );

        // We skip instrumenting external calls in pure and view functions to
        // avoid changing their mutability. This should not result in missing
        // any invariant violations since the external call can only call
        // another view/pure function, and as such can only return information
        // to the current context without any other side effects. Thus even if
        // there is a callback to this contract, that sees inconsistent state,
        // its still functionally equivalent to an internal call chain since
        // there are no other side-effects outside of this contract.
        if (
            calleeType instanceof FunctionType &&
            (calleeType.mutability === FunctionStateMutability.Pure ||
                calleeType.mutability === FunctionStateMutability.View)
        ) {
            continue;
        }

        // We need to special case the instrumentation for try-catch statements since we can't
        // replace the external try call with an internal wrapper call
        if (callSite.parent instanceof TryStatement && callSite.parent.vExternalCall === callSite) {
            instrumentTryCallsite(ctx, callSite.parent, generalInvChecker);
            continue;
        }

        const callsiteWrapper = interposeCall(ctx, contract, callSite);
        const wrapperBody = callsiteWrapper.vBody as Block;

        const callToOriginal = single(
            wrapperBody.vStatements,
            `Expected single statement in callsite wrapper {0}`,
            wrapperBody
        );

        wrapperBody.insertAtBeginning(
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
            wrapperBody.insertBefore(
                factory.makeExpressionStatement(
                    ctx.setInContract(
                        wrapperBody,
                        factory.makeLiteral("bool", LiteralKind.Bool, "", "false")
                    )
                ),
                callToOriginal
            );

            wrapperBody.appendChild(
                factory.makeExpressionStatement(
                    ctx.setInContract(
                        wrapperBody,
                        factory.makeLiteral("bool", LiteralKind.Bool, "", "true")
                    )
                )
            );
        }
    }
}

/**
 * Instrument the function `fn` in contract `contract`
 * with checks for the function-level invariants in `annotations`.
 */
export function instrumentFunction(
    ctx: InstrumentationContext,
    allAnnotations: AnnotationMetaData[],
    fn: FunctionDefinition,
    needsContractInvInstr: boolean
): void {
    const annotations = allAnnotations.filter(
        (annot): annot is PropertyMetaData | TryAnnotationMetaData =>
            annot instanceof PropertyMetaData || annot instanceof TryAnnotationMetaData
    );

    assert(
        allAnnotations.length === annotations.length,
        `NYI: Non-property annotations on functions.`
    );

    // Note: We don't interpose on constructors due to https://github.com/Consensys/scribble/issues/237
    const targetFn = fn.isConstructor ? fn : interpose(fn, ctx);
    const transCtx = ctx.transCtxMap.get(targetFn, InstrumentationSiteType.TwoPointWrapper);

    insertAnnotations(annotations, transCtx);

    // We only need to check state invariants on functions that are:
    //      1) Not in a library
    //      2) public or external
    //      3) mutating state (non-payable or payable)
    //      4) not the fallback() functions (since it may receive staticcalls)
    const checkStateInvs =
        needsContractInvInstr &&
        isExternallyVisible(targetFn) &&
        isChangingState(targetFn) &&
        fn.kind !== FunctionKind.Fallback;

    if (checkStateInvs) {
        insertEnterMarker(targetFn, transCtx);
        insertExitMarker(targetFn, transCtx);
    }
}

/**
 * For public/external functions insert a peramble that set the "out-of-contract" flag to false (marking that we are executing in the contract).
 * When the function is public, we remember the old value of the "out-of-contract" flag and restore it upon exit. This is done since
 * public function can also be invoked internally.
 */
function insertEnterMarker(stub: FunctionDefinition, transCtx: TranspilingContext): void {
    const body = stub.vBody as Block;
    const factory = transCtx.factory;
    const instrCtx = transCtx.instrCtx;

    const stmts: Statement[] = [];

    if (stub.visibility === FunctionVisibility.External) {
        const enter = factory.makeExpressionStatement(
            instrCtx.setInContract(
                stub,
                factory.makeLiteral("<missing>", LiteralKind.Bool, "", "true")
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
                factory.makeUnaryOperation("<missing>", true, "!", instrCtx.isInContract(stub))
            )
        );

        const enter = factory.makeExpressionStatement(
            instrCtx.setInContract(
                stub,
                factory.makeLiteral("<missing>", LiteralKind.Bool, "", "true")
            )
        );

        stmts.push(storeEntry, enter);
    }

    const before = body.vStatements.length > 0 ? body.vStatements[0] : undefined;

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
function insertExitMarker(stub: FunctionDefinition, transCtx: TranspilingContext): void {
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
            instrCtx.setInContract(
                stub,
                stub.visibility === FunctionVisibility.External
                    ? factory.makeLiteral("bool", LiteralKind.Bool, "", "false")
                    : factory.makeUnaryOperation(
                          "bool",
                          true,
                          "!",
                          transCtx.refBinding(instrCtx.checkInvsFlag)
                      )
            )
        )
    );

    for (const stmt of stmts) {
        instrCtx.addGeneralInstrumentation(stmt);

        body.appendChild(stmt);
    }
}

/**
 * Given an array type arrT (actually, poitner to array type) and a container, build a function that computes the
 * sum over an array of type `arrT` and add it to `container`
 */
export function makeArraySumFun(
    ctx: InstrumentationContext,
    container: ContractDefinition,
    arrT: ArrayType,
    loc: DataLocation
): FunctionDefinition {
    const factory = ctx.factory;

    assert(
        arrT.elementT instanceof IntType,
        "makeArraySum expects a numeric array type not {0}",
        arrT
    );

    const name = `sum_arr_${getTypeDesc(arrT)}_${loc}`;
    const sumT = new IntType(256, arrT.elementT.signed);

    const fun = factory.addEmptyFun(ctx, name, FunctionVisibility.Internal, container);
    const body = factory.addStmt(fun, factory.makeUncheckedBlock([])) as UncheckedBlock;

    const arr = factory.addFunArg("arr", arrT, loc, fun);
    const ret = factory.addFunRet(ctx, "ret", sumT, DataLocation.Default, fun);

    const idx = factory.makeVariableDeclaration(
        false,
        false,
        "idx",
        (fun.vBody as Block).id, //note: This id might not be valid, but it shouldn't matter much here
        false,
        DataLocation.Default,
        StateVariableVisibility.Default,
        Mutability.Mutable,
        "<missing>",
        undefined,
        factory.makeElementaryTypeName("<missing>", "uint256")
    );

    factory.addStmt(
        body,
        factory.makeForStatement(
            factory.makeExpressionStatement(
                factory.makeAssignment(
                    "<missing>",
                    "+=",
                    factory.makeIdentifierFor(ret),
                    factory.makeIndexAccess(
                        "<missing>",
                        factory.makeIdentifierFor(arr),
                        factory.makeIdentifierFor(idx)
                    )
                )
            ),
            factory.makeVariableDeclarationStatement(
                [idx.id],
                [idx],
                factory.makeLiteral("<missing>", LiteralKind.Number, "", "0")
            ),
            factory.makeBinaryOperation(
                "<mising>",
                "<",
                factory.makeIdentifierFor(idx),
                factory.makeMemberAccess("<missing>", factory.makeIdentifierFor(arr), "length", -1)
            ),
            factory.makeExpressionStatement(
                factory.makeUnaryOperation("<missing>", false, "++", factory.makeIdentifierFor(idx))
            )
        )
    );

    return fun;
}

/**
 * Instrument the statement `stmt` with the annotations `allAnnotations`. These should all be
 * `assert`s.
 */
export function instrumentStatement(
    ctx: InstrumentationContext,
    allAnnotations: AnnotationMetaData[],
    stmt: Statement
): void {
    const factory = ctx.factory;
    const singlePointAnnots: AnnotationMetaData[] = [];
    const ifSucceedsAnnots: AnnotationMetaData[] = [];

    for (const annot of allAnnotations) {
        if (
            annot.type === AnnotationType.Assert ||
            annot.type === AnnotationType.Try ||
            annot.type === AnnotationType.Require ||
            annot.type === AnnotationType.LetAnnotation
        ) {
            singlePointAnnots.push(annot);
        } else if (annot.type === AnnotationType.IfSucceeds) {
            ifSucceedsAnnots.push(annot);
        } else {
            assert(false, `Unexpected annotaiton on statement ${annot.original}`);
        }
    }

    // Make sure stmt is contained in a block. (converts cases like `while () i++` to `while () { i++}`
    ensureStmtInBlock(stmt, factory);

    const container = stmt.parent as Block;
    const beforeStmtBlock = factory.makeInstrBlock();

    // Add a new block before the target statement where we will transpile the assertions
    container.insertBefore(beforeStmtBlock, stmt);

    const fun = stmt.getClosestParentByType(FunctionDefinition);

    assert(fun !== undefined, "Unexpected orphan stmt", stmt);

    const transCtx = ctx.transCtxMap.get(fun, InstrumentationSiteType.Custom);

    transCtx.resetMarker([beforeStmtBlock, "end"], false);

    insertAnnotations(singlePointAnnots as PropertyMetaData[], transCtx);

    if (ifSucceedsAnnots.length > 0) {
        const afterStmtBlock = factory.makeInstrBlock();
        container.insertAfter(afterStmtBlock, stmt);

        const transCtx = ctx.transCtxMap.get(fun, InstrumentationSiteType.Custom);

        transCtx.resetMarker([beforeStmtBlock, "end"], true);
        transCtx.resetMarker([afterStmtBlock, "end"], false);

        insertAnnotations(ifSucceedsAnnots as PropertyMetaData[], transCtx);
    }

    stmt.documentation = undefined;
}
