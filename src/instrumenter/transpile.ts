import {
    AddressType,
    ArrayType,
    assert,
    ASTNodeFactory,
    Block,
    BoolType,
    BytesType,
    ContractDefinition,
    DataLocation,
    ElementaryTypeName,
    EnumDefinition,
    Expression,
    FixedBytesType,
    FunctionCallKind,
    FunctionDefinition,
    FunctionType,
    FunctionVisibility,
    Identifier,
    IntLiteralType,
    IntType,
    LiteralKind,
    Mutability,
    PointerType,
    StateVariableVisibility,
    StringType,
    StructDefinition,
    TupleType,
    TypeName,
    TypeNameType,
    TypeNode,
    UserDefinedType,
    VariableDeclaration
} from "solc-typed-ast";
import { AnnotationMetaData, PropertyMetaData, single, UserFunctionDefinitionMetaData } from "..";
import {
    SAddressLiteral,
    SBinaryOperation,
    SBooleanLiteral,
    SConditional,
    SForAll,
    SFunctionCall,
    SHexLiteral,
    SId,
    SIndexAccess,
    SLet,
    SMemberAccess,
    SNode,
    SNumber,
    SResult,
    SStringLiteral,
    SUnaryOperation,
    SUserFunctionDefinition
} from "../spec-lang/ast";
import { BuiltinSymbols, SemInfo, StateVarScope } from "../spec-lang/tc";
import { FunctionSetType } from "../spec-lang/tc/internal_types";
import { TranspilingContext } from "./transpiling_context";

/**
 * Transpile the `TypeNode` `type` (using the passed in `ASTNodeFactory`).
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
        return factory.makeElementaryTypeName(`<missing>`, type.pp());
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

    throw new Error(`NYI emitting spec type ${type.pp()}`);
}

/**
 * Transpile the `SId` `expr` in the context of `ctx.container`.
 */
function transpileId(expr: SId, ctx: TranspilingContext): Expression {
    const typeEnv = ctx.typeEnv;
    const factory = ctx.factory;

    if (BuiltinSymbols.has(expr.name)) {
        return factory.makeIdentifier("<missing>", expr.name, -1);
    }

    // Builtin symbols are the only identifiers with undefined `defSite`.
    if (expr.defSite === undefined) {
        throw new Error(
            `Cannot generate AST for id ${expr.pp()} with no corrseponding definition.`
        );
    }

    // Normal solidity variable - function argument, return, state variable or global constant.
    if (expr.defSite instanceof VariableDeclaration) {
        if (expr.name !== expr.defSite.name) {
            throw new Error(
                `Internal error: variable id ${expr.pp()} has different name from underlying variabl ${expr.defSite.print()}`
            );
        }

        return factory.makeIdentifierFor(expr.defSite);
    }

    // Let-variable used inside the body
    if (expr.defSite instanceof Array && expr.defSite[0] instanceof SLet) {
        return ctx.refBinding(ctx.getLetBinding(expr));
    }

    // ForAll iterator var
    if (expr.defSite instanceof SForAll) {
        return ctx.refBinding(ctx.getForAllIterVar(expr.defSite));
    }

    // User function argument
    if (expr.defSite instanceof Array && expr.defSite[0] instanceof SUserFunctionDefinition) {
        const instrCtx = ctx.instrCtx;
        const transpiledUserFun = instrCtx.userFunctions.get(expr.defSite[0]);
        assert(
            transpiledUserFun !== undefined,
            `Missing transpiled version of user function ${expr.defSite[0].pp()}`
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
        return factory.makeIdentifierFor(ctx.container.vParameters.vParameters[argIdx]);
    }

    // User function itself
    if (expr.defSite instanceof SUserFunctionDefinition) {
        const instrCtx = ctx.instrCtx;
        const transpiledUserFun = instrCtx.userFunctions.get(expr.defSite);
        assert(
            transpiledUserFun !== undefined,
            `Missing transpiled version of user function ${expr.defSite.pp()}`
        );

        return factory.makeIdentifierFor(transpiledUserFun);
    }

    // This identifier
    if (expr.defSite === "this") {
        return factory.makeIdentifier(
            "<missing>",
            "this",
            (ctx.container.vScope as ContractDefinition).id
        );
    }

    // Function, Public Getter, Contract or Type name
    let referrencedDef:
        | FunctionDefinition
        | StructDefinition
        | EnumDefinition
        | ContractDefinition
        | VariableDeclaration;

    const exprT = typeEnv.typeOf(expr);

    if (exprT instanceof FunctionSetType) {
        referrencedDef = single(exprT.definitions);
    } else if (exprT instanceof UserDefinedType) {
        if (exprT.definition === undefined) {
            throw new Error(
                `Id ${expr.pp()} of user defined type ${exprT.pp()} is missing a definition.`
            );
        }

        referrencedDef = exprT.definition;
    } else {
        throw new Error(`Unknown `);
    }

    return factory.makeIdentifierFor(referrencedDef);
}

/**
 * Transpile the `SResult` `expr` in the context of `ctx.container`.
 */
function transpileResult(expr: SResult, ctx: TranspilingContext): Expression {
    const factory = ctx.factory;
    const retParams = ctx.container.vReturnParameters.vParameters;

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
    const base = transpile(expr.base, ctx);
    const index = transpile(expr.index, ctx);

    assert(
        base instanceof Expression,
        `InternalError: Base of ${expr.pp()} transpiled to non-expression node ${
            base.constructor.name
        }`
    );

    assert(
        index instanceof Expression,
        `InternalError: Index of ${expr.pp()} transpiled to non-expression node ${
            index.constructor.name
        }`
    );

    return factory.makeIndexAccess("<missing>", base, index);
}

/**
 * Transpile the `SMemberAccess` `expr` in the context of `ctx.container`.
 */
function transpileMemberAccess(expr: SMemberAccess, ctx: TranspilingContext): Expression {
    const factory = ctx.factory;
    const base = transpile(expr.base, ctx);
    const type = ctx.typeEnv.typeOf(expr);

    let referencedDeclaration = -1;

    if (type instanceof FunctionSetType) {
        referencedDeclaration = single(type.definitions).id;
    } else if (type instanceof UserDefinedType && type.definition) {
        referencedDeclaration = type.definition.id;
    }
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
        const bindingName = ctx.getOldVar(expr);
        const type = ctx.typeEnv.typeOf(expr.subexp);
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
        callee = transpile(expr.callee, ctx);

        if (
            callee instanceof Identifier &&
            callee.vReferencedDeclaration instanceof FunctionDefinition &&
            callee.vReferencedDeclaration.visibility === FunctionVisibility.External
        ) {
            callee = factory.makeMemberAccess(
                "<missing>",
                factory.makeIdentifier(
                    "<missing>",
                    "this",
                    (ctx.container.vScope as ContractDefinition).id
                ),
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
        const getLhsT = (i: number): TypeNode =>
            rhsT instanceof TupleType ? rhsT.elements[i] : (rhsT as FunctionType).returns[i];

        for (let i = 0; i < expr.lhs.length; i++) {
            const name = ctx.getLetBinding([expr, i]);
            const type = transpileType(getLhsT(i), ctx.factory);
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

/**
 * Transpile the `SForAll` statement `expr`. Note that this will generate and insert a loop
 * in `ctx.container`.
 */
function transpileForAll(expr: SForAll, ctx: TranspilingContext): Expression {
    const factory = ctx.factory;
    const isOld = (ctx.semInfo.get(expr) as SemInfo).isOld;

    // Add temp bindings for iterator variable and result var
    const iterVarName = ctx.getForAllIterVar(expr);
    const resultVarName = ctx.getForAllVar(expr);

    ctx.addBinding(iterVarName, transpileType(expr.iteratorType, ctx.factory));
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

    // Iteration variable initialization statmenet
    const initStmt = factory.makeExpressionStatement(
        factory.makeAssignment(
            "<missing>",
            "=",
            ctx.refBinding(iterVarName),
            transpile(expr.start, ctx)
        )
    );

    // Loop condition
    const iterCond = factory.makeBinaryOperation(
        "<missing>",
        "<",
        ctx.refBinding(iterVarName),
        transpile(expr.end, ctx)
    );

    // Iteration variable increment
    const incStmt = factory.makeExpressionStatement(
        factory.makeUnaryOperation("<missing>", false, "++", ctx.refBinding(iterVarName))
    );

    const body: Block = factory.makeBlock([]);

    // Build and insert a for-loop with empty body
    ctx.insertStatement(factory.makeForStatement(body, initStmt, iterCond, incStmt), isOld, true);

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
): Expression {
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
        const numStr = expr.num.toString(expr.radix);

        return factory.makeLiteral(
            "<missing>",
            LiteralKind.Number,
            "",
            expr.radix === 16 ? "0x" + numStr : numStr
        );
    }

    if (expr instanceof SBooleanLiteral) {
        return factory.makeLiteral("<missing>", LiteralKind.Bool, "", expr.val ? "true" : "false");
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

export function getTypeLocation(type: TypeNode): DataLocation {
    if (type instanceof PointerType) {
        return type.location;
    }

    return DataLocation.Default;
}

/**
 * Generate an ASTVariableDeclaration for:
 *  - function params
 *  - function returns
 *  - function local vars
 *
 * @param name - name of the new var
 * @param type - Scribble type of the var
 * @param factory - ASTNodeFactory
 */
export function transpileFunVarDecl(
    name: string,
    type: TypeNode,
    ctx: TranspilingContext
): VariableDeclaration {
    const astType = transpileType(type, ctx.factory);

    return ctx.factory.makeVariableDeclaration(
        false,
        false,
        name,
        -1,
        false,
        getTypeLocation(type),
        StateVariableVisibility.Default,
        Mutability.Mutable,
        "<missing>",
        undefined,
        astType
    );
}
