import { gte } from "semver";
import {
    AddressType,
    ArrayType,
    assert,
    ASTNodeFactory,
    Block,
    BoolType,
    BytesType,
    castable,
    ContractDefinition,
    ElementaryTypeName,
    EnumDefinition,
    Expression,
    FixedBytesType,
    ForStatement,
    FunctionCallKind,
    FunctionDefinition,
    FunctionType,
    FunctionVisibility,
    globalBuiltins,
    Identifier,
    ImportDirective,
    ImportRefType,
    IntLiteralType,
    IntType,
    LiteralKind,
    MappingType,
    PointerType,
    SourceUnit,
    StringType,
    StructDefinition,
    TupleType,
    TypeName,
    TypeNameType,
    TypeNode,
    types,
    UserDefinedType,
    UserDefinedValueTypeDefinition,
    VariableDeclaration
} from "solc-typed-ast";
import { LetAnnotationMetaData } from ".";
import {
    AnnotationType,
    SAddressLiteral,
    SBinaryOperation,
    SBooleanLiteral,
    SConditional,
    ScribbleBuiltinFunctions,
    SForAll,
    SFunctionCall,
    SHexLiteral,
    SId,
    SIndexAccess,
    SLet,
    SLetAnnotation,
    SMemberAccess,
    SNode,
    SNumber,
    SolidityBuiltinFunctions,
    SResult,
    SStringLiteral,
    SUnaryOperation,
    SUserConstantDefinition,
    SUserFunctionDefinition,
    VarDefSite
} from "../spec-lang/ast";
import { decomposeStateVarRef, SemInfo, StateVarScope, unwrapOld } from "../spec-lang/tc";
import { FunctionSetType } from "../spec-lang/tc/internal_types";
import { single } from "../util/misc";
import {
    AnnotationMetaData,
    PropertyMetaData,
    TryAnnotationMetaData,
    UserConstantDefinitionMetaData,
    UserFunctionDefinitionMetaData
} from "./annotations";
import { TranspilingContext } from "./transpiling_context";

/**
 * Transpile the `TypeNode` `type` (using the passed in `ASTNodeFactory`).
 * @todo (dimo,pavel): Remove this and replace all uses with ScribbleFactory.typeNodeToVariableDecl.
 */
export function transpileType(type: TypeNode, factory: ASTNodeFactory): TypeName {
    if (
        type instanceof TupleType ||
        type instanceof IntLiteralType ||
        type instanceof FunctionSetType
    ) {
        throw new Error(`Unsupported spec type ${type.pp()}`);
    }

    if (
        type instanceof AddressType ||
        type instanceof BoolType ||
        type instanceof BytesType ||
        type instanceof FixedBytesType ||
        type instanceof IntType ||
        type instanceof StringType
    ) {
        return factory.makeElementaryTypeName("<missing>", type.pp());
    }

    if (type instanceof PointerType) {
        return transpileType(type.to, factory);
    }

    if (type instanceof UserDefinedType) {
        return factory.makeUserDefinedTypeName("<missing>", type.name, type.definition.id);
    }

    if (type instanceof ArrayType) {
        return factory.makeArrayTypeName(
            "<missing>",
            transpileType(type.elementT, factory),
            type.size !== undefined
                ? factory.makeLiteral("<missing>", LiteralKind.Number, "", "" + type.size)
                : undefined
        );
    }

    if (type instanceof MappingType) {
        const keyT =
            type.keyType instanceof AddressType && type.keyType.payable
                ? new AddressType(false)
                : type.keyType;

        return factory.makeMapping(
            "<missing>",
            transpileType(keyT, factory),
            transpileType(type.valueType, factory)
        );
    }

    throw new Error(`NYI emitting spec type ${type.pp()}`);
}

/**
 * Return true IFF the type `type` can be output in a debug event. This currently
 * includes primitive types, strings and bytes, and arrays over these
 */
function isTypeTraceable(type: TypeNode, ctx: TranspilingContext): boolean {
    // Primitive types
    if (
        type instanceof AddressType ||
        type instanceof BoolType ||
        type instanceof FixedBytesType ||
        type instanceof IntType
    ) {
        return true;
    }

    // Enums
    if (type instanceof UserDefinedType && type.definition instanceof EnumDefinition) {
        return true;
    }

    if (type instanceof PointerType) {
        // Strings and bytes
        if (type.to instanceof StringType || type.to instanceof BytesType) {
            return true;
        }

        // Arrays
        if (type.to instanceof ArrayType) {
            const version = ctx.instrCtx.compilerVersion;

            // For solidity >=0.8.0 we can emit nested arrays in events since ABIEncoderV2 is on by default
            if (gte(version, "0.8.0")) {
                return isTypeTraceable(type.to.elementT, ctx);
            }

            // For older solidity skip nested arrays
            if (type.to.elementT instanceof PointerType && type.to.elementT instanceof ArrayType) {
                return false;
            }

            // And otherwise just make sure the elemnt type is something sane (i.e. not maps)
            return isTypeTraceable(type.to.elementT, ctx);
        }
    }

    return false;
}

/**
 * Given an `SId` `id`, its corresponding transpiled form `transpiledExpr` and
 * the current `TranspilingContext` `ctx`, if `--debug-events` are on, and this
 * is the first time we encounter `id`, and its type is traceable (see
 * `isTypeTraceable`) then add debugging information for `id` to `ctx`.
 *
 * Note that special care needs to be taken for ids appearing in old contexts -
 * we need to add a new binding for them that stores their value.
 */
function addTracingInfo(id: SId, transpiledExpr: Expression, ctx: TranspilingContext): void {
    const typeEnv = ctx.typeEnv;
    const factory = ctx.factory;
    const exprT = typeEnv.typeOf(id);
    const dbgEventsOn = ctx.instrCtx.debugEvents;

    if (!dbgEventsOn) {
        return;
    }

    if (!isTypeTraceable(exprT, ctx)) {
        return;
    }

    // Skip try/require annotations as we don't emit assertion failed events for those
    if (
        ctx.curAnnotation.type === AnnotationType.Try ||
        ctx.curAnnotation.type === AnnotationType.Require
    ) {
        return;
    }

    /**
     * funDebugMap contains the debug ids for ALL annotations in the current function
     */
    const funDebugMap = ctx.dbIdsMap;

    /**
     * annotDebugMap contains only the debug ids for the currently transpiled annotation
     */
    const annotDebugMap = ctx.annotationDebugMap.get(ctx.curAnnotation);
    const defSite = id.defSite as VarDefSite;

    let argValue: Expression;

    /**
     * If we have already computed the value of this `SId` for debugging in this function, then re-use it
     *
     * TODO: This whole logic should be replaced by some form of 'available expressions' analysis attached to the
     * TranspilingContext.
     */
    if (!funDebugMap.has(defSite)) {
        const isOld = (ctx.semInfo.get(id) as SemInfo).isOld;

        if (isOld) {
            const dbgBinding = ctx.getDbgVar(id);

            ctx.addBinding(dbgBinding, transpileType(exprT, factory));

            const assignment = ctx.insertAssignment(
                ctx.refBinding(dbgBinding),
                factory.copy(transpiledExpr),
                true,
                true
            );

            ctx.instrCtx.addAnnotationInstrumentation(ctx.curAnnotation, assignment);

            argValue = ctx.refBinding(dbgBinding);
        } else {
            argValue = factory.copy(transpiledExpr);
        }

        funDebugMap.set([[id], argValue, exprT], defSite);
    } else {
        let ids: SId[];

        [ids, argValue] = funDebugMap.mustGet(defSite);
        ids.push(id);
    }

    /**
     * Add this id's information to the per-annotation map used for computing
     * event signatures later on.
     */
    if (!annotDebugMap.has(defSite)) {
        annotDebugMap.set([[id], argValue, exprT], defSite);
    } else {
        annotDebugMap.mustGet(defSite)[0].push(id);
    }
}

/**
 * Transpile the `SId` `expr` in the context of `ctx.container`.
 */
function transpileId(expr: SId, ctx: TranspilingContext): Expression {
    const typeEnv = ctx.typeEnv;
    const factory = ctx.factory;

    if (globalBuiltins.members.has(expr.name)) {
        return factory.makeIdentifier("<missing>", expr.name, -1);
    }

    // Builtin symbols are the only identifiers with undefined `defSite`.
    assert(
        expr.defSite !== undefined,
        "Cannot generate AST for id {0} with no corresponding definition.",
        expr
    );

    // Normal solidity variable - function argument, return, state variable or global constant.
    if (expr.defSite instanceof VariableDeclaration) {
        if (expr.name !== expr.defSite.name) {
            assert(
                expr.defSite.stateVariable || expr.defSite.vScope instanceof SourceUnit,
                `Internal error: variable id {0} has different name from underlying variable {1}. Variable renaming only allowed for public state vars with maps and imported global vars.`,
                expr,
                expr.defSite
            );
        }

        let res: Identifier;
        // If the scribble name doesn't match the name of the underlying definition there are several cases:
        // 1) This is a state variable - pick the underlying definition, since
        //  we sometimes rename public state vars during instrumentation to allow
        //  for an explicit getter fun
        // 2) Global symbol in flat/json mode - pick the underlying definition, since all definitions are
        //  flattened and renamed to avoid collisions
        // 3) Global symbol in files mode - pick the scribble identifier - this is a case of import renaming
        // 4) All other cases - pick the Scribble name
        if (
            expr.name !== expr.defSite.name &&
            (expr.defSite.stateVariable ||
                (expr.defSite.vScope instanceof SourceUnit && ctx.instrCtx.outputMode !== "files"))
        ) {
            res = factory.makeIdentifierFor(expr.defSite);
        } else {
            res = factory.makeIdentifier("<missing>", expr.name, expr.defSite.id);
        }

        addTracingInfo(expr, res, ctx);

        return res;
    }

    // User-defined constant
    if (expr.defSite instanceof SUserConstantDefinition) {
        const transpiledDecl = ctx.instrCtx.userConstants.get(expr.defSite);

        assert(
            transpiledDecl !== undefined,
            "Missing transpiled version of user constant {0}",
            expr.defSite
        );

        const res = ctx.factory.makeIdentifierFor(transpiledDecl);

        addTracingInfo(expr, res, ctx);

        return res;
    }

    // Let-statement annotation
    if (expr.defSite instanceof SLetAnnotation) {
        const res = ctx.refBinding(ctx.getLetAnnotationBinding(expr.defSite));

        addTracingInfo(expr, res, ctx);

        return res;
    }

    // Let-variable used inside the body
    if (expr.defSite instanceof Array && expr.defSite[0] instanceof SLet) {
        const res = ctx.refBinding(ctx.getLetBinding(expr));

        addTracingInfo(expr, res, ctx);

        return res;
    }

    // ForAll iterator var
    if (expr.defSite instanceof SForAll) {
        const res = ctx.refBinding(ctx.getForAllIterVar(expr.defSite));

        addTracingInfo(expr, res, ctx);

        return res;
    }

    // User function argument
    if (expr.defSite instanceof Array && expr.defSite[0] instanceof SUserFunctionDefinition) {
        const instrCtx = ctx.instrCtx;
        const transpiledUserFun = instrCtx.userFunctions.get(expr.defSite[0]);

        assert(
            transpiledUserFun !== undefined,
            "Missing transpiled version of user function {0}",
            expr.defSite[0]
        );

        return factory.makeIdentifierFor(
            transpiledUserFun.vParameters.vParameters[expr.defSite[1]]
        );
    }

    // State Var Property index identifier
    if (expr.defSite instanceof Array && expr.defSite[0] instanceof StateVarScope) {
        const [scope, idx] = expr.defSite;
        const prop = scope.annotation;

        // Count the indices (omitting member accesses) before `idx`
        let argIdx = 0;

        for (let i = 0; i < idx; i++) {
            const el = prop.datastructurePath[i];

            if (typeof el !== "string") {
                argIdx++;
            }
        }

        const res = factory.makeIdentifierFor(ctx.containerFun.vParameters.vParameters[argIdx]);

        addTracingInfo(expr, res, ctx);

        return res;
    }

    // User function itself
    if (expr.defSite instanceof SUserFunctionDefinition) {
        const instrCtx = ctx.instrCtx;
        const transpiledUserFun = instrCtx.userFunctions.get(expr.defSite);

        assert(
            transpiledUserFun !== undefined,
            "Missing transpiled version of user function {0}",
            expr.defSite
        );

        return factory.makeIdentifierFor(transpiledUserFun);
    }

    // This identifier
    if (expr.defSite === "this") {
        return factory.makeIdentifier("<missing>", "this", ctx.containerContract.id);
    }

    // Function, Public Getter, Contract, Type name or imported unit name
    let referrencedDef:
        | FunctionDefinition
        | StructDefinition
        | EnumDefinition
        | ContractDefinition
        | VariableDeclaration
        | ImportDirective
        | UserDefinedValueTypeDefinition;

    const exprT = typeEnv.typeOf(expr);

    if (exprT instanceof FunctionSetType) {
        referrencedDef = single(exprT.definitions);
    } else if (exprT instanceof UserDefinedType) {
        assert(
            exprT.definition !== undefined,
            `Id {0} of user defined type {1} is missing a definition.`,
            expr,
            exprT
        );

        referrencedDef = exprT.definition;
    } else if (exprT instanceof ImportRefType) {
        referrencedDef = exprT.importStmt;
    } else if (exprT instanceof TypeNameType && exprT.type instanceof UserDefinedType) {
        referrencedDef = exprT.type.definition;
    } else {
        throw new Error(`Unknown id type ${exprT.pp()}`);
    }

    return factory.makeIdentifierFor(referrencedDef);
}

/**
 * Transpile the `SResult` `expr` in the context of `ctx.container`.
 */
function transpileResult(expr: SResult, ctx: TranspilingContext): Expression {
    const factory = ctx.factory;
    const retParams = ctx.containerFun.vReturnParameters.vParameters;

    if (retParams.length === 1) {
        return factory.makeIdentifierFor(retParams[0]);
    }

    if (retParams.length > 1) {
        return factory.makeTupleExpression(
            "<missing>",
            false,
            retParams.map((param) => factory.makeIdentifierFor(param))
        );
    }

    throw new Error(`InternalError: attempt to transpile $result in function without returns.`);
}

/**
 * Transpile the `SIndexAccess` `expr` in the context of `ctx.container`.
 */
function transpileIndexAccess(expr: SIndexAccess, ctx: TranspilingContext): Expression {
    const factory = ctx.factory;
    const instrCtx = ctx.instrCtx;
    const base = transpile(expr.base, ctx);
    const index = transpile(expr.index, ctx);

    assert(
        base instanceof Expression,
        "InternalError: Base of {0} transpiled to non-expression node {1}",
        expr,
        base.constructor.name
    );

    assert(
        index instanceof Expression,
        "InternalError: Index of {0} transpiled to non-expression node {1}",
        expr,
        index.constructor.name
    );

    // Some maps inside state vars may have been re-writen as structs with library
    // accessors. If this index access is to such a map, then we need to
    // transpile it as a call to the proper getter
    const [sVar, path] = decomposeStateVarRef(expr);

    if (sVar !== undefined) {
        const interposeLib = instrCtx.sVarToLibraryMap.get(
            sVar,
            path.slice(0, -1).map((x) => (x instanceof SNode ? null : x))
        );

        if (interposeLib !== undefined) {
            const getter = instrCtx.libToMapGetterMap.get(interposeLib, false);

            return factory.makeFunctionCall(
                "<missing>",
                FunctionCallKind.FunctionCall,
                factory.makeMemberAccess(
                    "<missing>",
                    factory.makeIdentifierFor(interposeLib),
                    getter.name,
                    getter.id
                ),
                [base, index]
            );
        }
    }

    // Otherwise transpile this as a normal index access
    return factory.makeIndexAccess("<missing>", base, index);
}

/**
 * Transpile the `SMemberAccess` `expr` in the context of `ctx.container`.
 */
function transpileMemberAccess(expr: SMemberAccess, ctx: TranspilingContext): Expression {
    const factory = ctx.factory;
    const base = transpile(expr.base, ctx);

    const referencedDeclaration = expr.defSite !== undefined ? expr.defSite.id : -1;
    return factory.makeMemberAccess("<missing>", base, expr.member, referencedDeclaration);
}

/**
 * Transpile the `SUnaryOperation` `expr` in the context of `ctx.container`.
 *
 * Note: When the unary operation is `old()` this will insert additional
 * assignments _before_ the wrapped original call/statement.
 */
function transpileUnaryOperation(expr: SUnaryOperation, ctx: TranspilingContext): Expression {
    const factory = ctx.factory;
    const subExp = transpile(expr.subexp, ctx);

    if (expr.op === "old") {
        const type = ctx.typeEnv.typeOf(expr.subexp);
        const semInfo = ctx.semInfo.get(expr);

        assert(semInfo !== undefined, "Missing semantic info for {0}", expr);

        if (semInfo.isConst) {
            return subExp;
        }

        const bindingName = ctx.getOldVar(expr);

        ctx.addBinding(bindingName, transpileType(type, ctx.factory));

        const binding = ctx.refBinding(bindingName);

        ctx.insertAssignment(binding, subExp, true, true);

        return ctx.refBinding(bindingName);
    }

    return factory.makeUnaryOperation("<missing>", true, expr.op, subExp);
}

/**
 * Transpile the `SBinaryOperation` `expr` in the context of `ctx.container`.
 */
function transpileBinaryOperation(expr: SBinaryOperation, ctx: TranspilingContext): Expression {
    const factory = ctx.factory;
    const left = transpile(expr.left, ctx);
    const right = transpile(expr.right, ctx);

    if (expr.op === "==>") {
        const notPrecedent = factory.makeUnaryOperation("missing", true, "!", left);

        return factory.makeBinaryOperation("<missing>", "||", notPrecedent, right);
    }

    return factory.makeBinaryOperation("<missing>", expr.op, left, right);
}

/**
 * Transpile the `SConditional` `expr` in the context of `ctx.container`.
 */
function transpileConditional(expr: SConditional, ctx: TranspilingContext): Expression {
    const factory = ctx.factory;
    const condition = transpile(expr.condition, ctx);
    const trueExp = transpile(expr.trueExp, ctx);
    const falseExp = transpile(expr.falseExp, ctx);

    return factory.makeConditional("<missing>", condition, trueExp, falseExp);
}

/**
 * Transpile the `SFunctionCall` `expr` in the context of `ctx.container`.
 */
function transpileFunctionCall(expr: SFunctionCall, ctx: TranspilingContext): Expression {
    const factory = ctx.factory;

    // Builtin functions
    if (expr.callee instanceof SId && expr.callee.defSite === "builtin_fun") {
        if (expr.callee.name === ScribbleBuiltinFunctions.unchecked_sum) {
            const arg = single(expr.args);
            const argT = ctx.typeEnv.typeOf(arg);

            assert(
                argT instanceof PointerType,
                "sum expects a pointer to array/map, not {0}",
                argT
            );

            if (argT.to instanceof MappingType) {
                const [sVar, path] = decomposeStateVarRef(arg);

                assert(
                    sVar !== undefined,
                    "sum argument should be a state var(or a part of it), not {0}",
                    arg
                );

                const lib = ctx.instrCtx.sVarToLibraryMap.get(
                    sVar,
                    path.map((el) => (el instanceof SNode ? null : el))
                );

                assert(lib !== undefined, `State var ${sVar.name} should already be interposed`);

                const struct = single(lib.vStructs);

                return factory.mkStructFieldAcc(transpile(arg, ctx), struct, "sum");
            }

            assert(
                argT.to instanceof ArrayType,
                "sum expects a pointer to array/map, not {0}",
                argT
            );

            const sumFun = ctx.instrCtx.arraySumFunMap.get(
                argT.to,
                argT.location,
                ctx.contract.getClosestParentByType(SourceUnit) as SourceUnit
            );

            return factory.makeFunctionCall(
                "<missing>",
                FunctionCallKind.FunctionCall,
                factory.mkLibraryFunRef(ctx.instrCtx, sumFun),
                [transpile(arg, ctx)]
            );
        }

        if (expr.callee.name === ScribbleBuiltinFunctions.eq_encoded) {
            const fun = ctx.instrCtx.getBuiltinFun(
                ctx.contract.getClosestParentByType(SourceUnit) as SourceUnit,
                expr.callee.name
            );

            return factory.makeFunctionCall(
                "<missing>",
                FunctionCallKind.FunctionCall,
                fun,
                expr.args.map((arg) => {
                    const argT = ctx.typeEnv.typeOf(arg);
                    const solArg = transpile(arg, ctx);

                    if (castable(argT, types.bytesMemory, ctx.typeEnv.compilerVersion)) {
                        return solArg;
                    }

                    return factory.makeFunctionCall(
                        "<missing>",
                        FunctionCallKind.FunctionCall,
                        factory.makeMemberAccess(
                            "<missing>",
                            factory.makeIdentifier("<missing>", "abi", -1),
                            "encode",
                            -1
                        ),
                        [solArg]
                    );
                })
            );
        }

        if (expr.callee.name === SolidityBuiltinFunctions.type) {
            const arg = single(expr.args);
            const argT = ctx.typeEnv.typeOf(arg);

            assert(argT instanceof TypeNameType, `type() expects a TypeNameType`);

            return factory.makeFunctionCall(
                "<missing>",
                FunctionCallKind.FunctionCall,
                factory.makeIdentifier("<missing>", SolidityBuiltinFunctions.type, -1),
                [transpileType(argT.type, factory)]
            );
        }
    }

    const calleeT = ctx.typeEnv.typeOf(expr.callee);

    let callee: Expression;

    const kind =
        calleeT instanceof TypeNameType
            ? FunctionCallKind.TypeConversion
            : FunctionCallKind.FunctionCall;

    if (calleeT instanceof TypeNameType) {
        // Type Cast
        if (calleeT.type instanceof UserDefinedType) {
            // User-defined type
            assert(calleeT.type.definition !== undefined, ``);

            callee = factory.makeIdentifierFor(calleeT.type.definition);
        } else {
            // Elementary type
            callee = factory.makeElementaryTypeNameExpression(
                "<missing>",
                transpileType(calleeT.type, ctx.factory) as ElementaryTypeName
            );
        }
    } else {
        // Normal function call
        assert(
            expr.callee instanceof SNode,
            `Unexpected type node {0} with type {1}`,
            expr.callee,
            calleeT
        );
        callee = transpile(expr.callee, ctx);

        if (
            callee instanceof Identifier &&
            callee.vReferencedDeclaration instanceof FunctionDefinition &&
            callee.vReferencedDeclaration.visibility === FunctionVisibility.External
        ) {
            callee = factory.makeMemberAccess(
                "<missing>",
                factory.makeIdentifier("<missing>", "this", ctx.containerContract.id),
                callee.name,
                callee.vReferencedDeclaration.id
            );
        }
    }

    const args = expr.args.map((arg) => transpile(arg, ctx));

    return factory.makeFunctionCall("<mising>", kind, callee, args);
}

/**
 * Transpile the `SLet` statement `expr`. Note that this will generate and insert additional
 * assignments in `ctx.container`.
 */
function transpileLet(expr: SLet, ctx: TranspilingContext): Expression {
    const factory = ctx.factory;
    const isLetOld = (ctx.semInfo.get(expr) as SemInfo).isOld;
    const isLetBindingOld = (ctx.semInfo.get(expr.rhs) as SemInfo).isOld;

    let rhs: Expression;

    if (expr.rhs instanceof SUnaryOperation && expr.rhs.op === "old") {
        rhs = transpile(expr.rhs.subexp, ctx);
    } else {
        rhs = transpile(expr.rhs, ctx);
    }

    const rhsT = ctx.typeEnv.typeOf(expr.rhs);
    const lhss: Expression[] = [];

    if (expr.lhs.length == 1) {
        const name = ctx.getLetBinding([expr, 0]);
        const type = transpileType(rhsT, ctx.factory);

        ctx.addBinding(name, type);

        lhss.push(ctx.refBinding(name));
    } else {
        const getLhsT = (i: number): TypeNode | null =>
            rhsT instanceof TupleType ? rhsT.elements[i] : (rhsT as FunctionType).returns[i];

        for (let i = 0; i < expr.lhs.length; i++) {
            const lhsT = getLhsT(i);

            assert(lhsT !== null, "Unsupported tuple with empty element in SLet: {0}", expr);

            const name = ctx.getLetBinding([expr, i]);
            const type = transpileType(lhsT, ctx.factory);

            ctx.addBinding(name, type);

            lhss.push(ctx.refBinding(name));
        }
    }

    let lhs: Expression;

    if (lhss.length === 1) {
        lhs = lhss[0];
    } else {
        lhs = factory.makeTupleExpression("<missing>", false, lhss);
    }

    ctx.insertAssignment(lhs, rhs, isLetBindingOld, true);

    const body = transpile(expr.in, ctx);
    const letVarName = ctx.getLetVar(expr);

    ctx.addBinding(letVarName, transpileType(ctx.typeEnv.typeOf(expr), ctx.factory));

    const letVar = ctx.refBinding(letVarName);

    ctx.insertAssignment(letVar, body, isLetOld, true);

    return ctx.refBinding(letVarName);
}

function makeForLoop(
    ctx: TranspilingContext,
    iterVarName: string,
    iterVarType: TypeNode,
    start: SNode,
    end: SNode | Expression
): ForStatement {
    const factory = ctx.factory;

    ctx.addBinding(iterVarName, transpileType(iterVarType, ctx.factory));

    // Iteration variable initialization statmenet
    const initStmt = factory.makeExpressionStatement(
        factory.makeAssignment("<missing>", "=", ctx.refBinding(iterVarName), transpile(start, ctx))
    );

    // Loop condition
    const iterCond = factory.makeBinaryOperation(
        "<missing>",
        "<",
        ctx.refBinding(iterVarName),
        end instanceof Expression ? end : transpile(end, ctx)
    );

    // Iteration variable increment
    const incStmt = factory.makeExpressionStatement(
        factory.makeUnaryOperation("<missing>", false, "++", ctx.refBinding(iterVarName))
    );

    const body = factory.makeBlock([]);

    // Build and insert a for-loop with empty body
    return factory.makeForStatement(body, initStmt, iterCond, incStmt);
}

/**
 * Transpile the `SForAll` statement `expr`. Note that this will generate and insert a loop
 * in `ctx.container`.
 */
function transpileForAll(expr: SForAll, ctx: TranspilingContext): Expression {
    const factory = ctx.factory;
    const isOld = (ctx.semInfo.get(expr) as SemInfo).isOld;
    const typeEnv = ctx.typeEnv;

    let forStmt: ForStatement;

    const iterVarName = ctx.getForAllIterVar(expr);
    const resultVarName = ctx.getForAllVar(expr);

    if (expr.container !== undefined) {
        const containerT = typeEnv.typeOf(expr.container);

        // Forall over a map
        if (containerT instanceof PointerType && containerT.to instanceof MappingType) {
            const internalCounter = ctx.instrCtx.nameGenerator.getFresh("i");
            const container = unwrapOld(expr.container);
            const [sVar, path] = decomposeStateVarRef(container);

            assert(sVar !== undefined, "Unexpected undefined state var in {0}", expr.container);

            const astContainer = transpile(container, ctx);
            const lib = ctx.instrCtx.sVarToLibraryMap.get(
                sVar,
                path.map((x) => (x instanceof SNode ? null : x))
            );

            assert(lib !== undefined, `Unexpected missing library for map ${sVar.name}`);

            const struct = single(lib.vStructs);
            const keys = factory.mkStructFieldAcc(astContainer, struct, "keys");
            const len = factory.makeMemberAccess("<missing>", keys, "length", -1);

            forStmt = makeForLoop(
                ctx,
                internalCounter,
                new IntType(256, false),
                new SNumber(BigInt(1), 10),
                len
            );

            ctx.addBinding(iterVarName, transpileType(expr.iteratorType, ctx.factory));

            factory.addStmt(
                forStmt.vBody as Block,
                factory.makeAssignment(
                    "<missing>",
                    "=",
                    ctx.refBinding(iterVarName),
                    factory.makeIndexAccess(
                        "<mising>",
                        factory.copy(keys),
                        ctx.refBinding(internalCounter)
                    )
                )
            );
        } else {
            // Forall over array
            const astContainer = transpile(expr.container, ctx);

            forStmt = makeForLoop(
                ctx,
                iterVarName,
                expr.iteratorType,
                new SNumber(BigInt(0), 10),
                factory.makeMemberAccess("<missing>", astContainer, "length", -1)
            );
        }
    } else {
        // Forall over numeric range
        forStmt = makeForLoop(
            ctx,
            iterVarName,
            expr.iteratorType,
            expr.start as SNode,
            expr.end as SNode
        );
    }

    ctx.addBinding(resultVarName, transpileType(new BoolType(), ctx.factory));

    // Initialize result of forall to true (so `forall (uint x in [0, 0)) false` is true).
    ctx.insertStatement(
        factory.makeAssignment(
            "<missing>",
            "=",
            ctx.refBinding(resultVarName),
            factory.makeLiteral("<missing>", LiteralKind.Bool, "", "true")
        ),
        isOld,
        true
    );

    const body = forStmt.vBody as Block;

    // Insert the created for-loop with empty body
    ctx.insertStatement(forStmt, isOld, true);

    // Transpile the predicate expression in the empty body of the newly inserted for-loop
    ctx.pushMarker([body, "end"], isOld);

    const bodyPred = transpile(expr.expression, ctx);

    // Update the result variable for the forall on every loop iteration
    ctx.insertStatement(
        factory.makeAssignment("<missing>", "=", ctx.refBinding(resultVarName), bodyPred),
        isOld,
        true
    );

    // If the result ever becomes false, terminate early
    ctx.insertStatement(
        factory.makeIfStatement(
            factory.makeUnaryOperation("<missing>", true, "!", ctx.refBinding(resultVarName)),
            factory.makeBreak()
        ),
        isOld,
        true
    );

    ctx.popMarker(isOld);

    return ctx.refBinding(resultVarName);
}

/**
 * Given `AnnotationMetaData` `annotationMD` and a `TranspilingContext` `ctx`
 * transpile the predicate/body of the annotation and return it.
 */
export function transpileAnnotation(
    annotMD: AnnotationMetaData,
    ctx: TranspilingContext
): Expression | Expression[] {
    /**
     * Bit of a hack to keep track of the currrent annotation being transpiled.
     * Useful for adding metadata to the InstrumentationContext
     */
    ctx.curAnnotation = annotMD;

    if (annotMD instanceof PropertyMetaData) {
        return transpile(annotMD.parsedAnnot.expression, ctx);
    }

    if (annotMD instanceof UserFunctionDefinitionMetaData) {
        return transpile(annotMD.parsedAnnot.body, ctx);
    }

    if (annotMD instanceof UserConstantDefinitionMetaData) {
        return transpile(annotMD.parsedAnnot.value, ctx);
    }

    if (annotMD instanceof LetAnnotationMetaData) {
        const rhs = annotMD.parsedAnnot.expression;
        const rhsType = ctx.typeEnv.typeOf(rhs);
        const solRhs = transpile(rhs, ctx);
        const name = ctx.getLetAnnotationBinding(annotMD.parsedAnnot);

        ctx.addBinding(name, transpileType(rhsType, ctx.factory));

        return solRhs;
    }

    if (annotMD instanceof TryAnnotationMetaData) {
        return annotMD.parsedAnnot.exprs.map((expr) => transpile(expr, ctx));
    }

    throw new Error(`NYI Annotation metadata type ${annotMD.constructor.name}`);
}

/**
 * Given a Scribble expression `expr` and a `TranspilingContext` `ctx` generate and return an ASTNode equivalnt to computing
 * `expr`.
 *
 * Note: This may involve inserting assignment statements to compute the values of `old()`, `let` and `forall` expressions.
 * In the case of `old()` expressions the newly inserted assignments would be in the appropriate location before the wrapped statement.
 */
export function transpile(expr: SNode, ctx: TranspilingContext): Expression {
    const factory = ctx.factory;

    if (expr instanceof SNumber) {
        return factory.makeLiteral("<missing>", LiteralKind.Number, "", expr.pp());
    }

    if (expr instanceof SBooleanLiteral) {
        return factory.makeLiteral("<missing>", LiteralKind.Bool, "", expr.pp());
    }

    if (expr instanceof SStringLiteral) {
        return factory.makeLiteral("<missing>", LiteralKind.String, "", expr.val);
    }

    if (expr instanceof SHexLiteral) {
        return factory.makeLiteral("<missing>", LiteralKind.String, expr.val, null as any);
    }

    if (expr instanceof SAddressLiteral) {
        return factory.makeLiteral("<missing>", LiteralKind.Number, "", expr.val);
    }

    if (expr instanceof SId) {
        return transpileId(expr, ctx);
    }

    if (expr instanceof SResult) {
        return transpileResult(expr, ctx);
    }

    if (expr instanceof SIndexAccess) {
        return transpileIndexAccess(expr, ctx);
    }

    if (expr instanceof SMemberAccess) {
        return transpileMemberAccess(expr, ctx);
    }

    if (expr instanceof SUnaryOperation) {
        return transpileUnaryOperation(expr, ctx);
    }

    if (expr instanceof SBinaryOperation) {
        return transpileBinaryOperation(expr, ctx);
    }

    if (expr instanceof SConditional) {
        return transpileConditional(expr, ctx);
    }

    if (expr instanceof SFunctionCall) {
        return transpileFunctionCall(expr, ctx);
    }

    if (expr instanceof SLet) {
        return transpileLet(expr, ctx);
    }

    if (expr instanceof SForAll) {
        return transpileForAll(expr, ctx);
    }

    if (expr instanceof TypeNode) {
        return transpileType(expr, ctx.factory);
    }

    throw new Error(`NYI transpiling node ${expr.pp()}`);
}
