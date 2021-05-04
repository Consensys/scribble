import {
    AddressType,
    ArrayType,
    ASTNodeFactory,
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
import {
    SBinaryOperation,
    SBooleanLiteral,
    SConditional,
    SFunctionCall,
    SHexLiteral,
    SId,
    SIndexAccess,
    SLet,
    SMemberAccess,
    SNode,
    SNumber,
    SStringLiteral,
    SUnaryOperation,
    SAddressLiteral,
    SResult,
    SUserFunctionDefinition
} from "../spec-lang/ast";
import { BuiltinSymbols, FunctionSetType, StateVarScope, STypingCtx } from "../spec-lang/tc";
import { assert, single } from "../util";
import { TranspilingContext } from "./transpiling_context";

export function generateTypeAst(type: TypeNode, factory: ASTNodeFactory): TypeName {
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
        return generateTypeAst(type.to, factory);
    }

    if (type instanceof UserDefinedType) {
        // @todo remove this hack when we fix the types obtained from the typeString parser in getExprSType()
        const id = type.definition !== undefined ? type.definition.id : -1;
        return factory.makeUserDefinedTypeName("<missing>", type.name, id);
    }

    if (type instanceof ArrayType) {
        return factory.makeArrayTypeName(
            "<missing>",
            generateTypeAst(type.elementT, factory),
            type.size !== undefined
                ? factory.makeLiteral("<missing>", LiteralKind.Number, "", "" + type.size)
                : undefined
        );
    }

    throw new Error(`NYI emitting spec type ${type.pp()}`);
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
export function generateFunVarDecl(
    name: string,
    type: TypeNode,
    factory: ASTNodeFactory
): VariableDeclaration {
    const astType = generateTypeAst(type, factory);

    return factory.makeVariableDeclaration(
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

export function generateIdAST(
    spec: SId,
    transCtx: TranspilingContext,
    loc: STypingCtx
): Expression {
    const typeEnv = transCtx.typeEnv;
    const factory = transCtx.factory;

    if (BuiltinSymbols.has(spec.name)) {
        return factory.makeIdentifier("<missing>", spec.name, -1);
    }

    // State Var Property index identifier
    if (spec.defSite instanceof Array && spec.defSite[0] instanceof StateVarScope) {
        const [scope, idx] = spec.defSite;
        const prop = scope.annotation;
        // Count the indices (omitting member accesses) before `idx`
        let argIdx = 0;
        for (let i = 0; i < idx; i++) {
            const el = prop.datastructurePath[i];
            if (typeof el !== "string") {
                argIdx++;
            }
        }
        return factory.makeIdentifierFor(transCtx.container.vParameters.vParameters[argIdx]);
    }

    // User function argument
    if (spec.defSite instanceof Array && spec.defSite[0] instanceof SUserFunctionDefinition) {
        const instrCtx = transCtx.instrCtx;
        const transpiledUserFun = instrCtx.userFunctions.get(spec.defSite[0]);
        assert(
            transpiledUserFun !== undefined,
            `Missing transpiled version of user function ${spec.defSite[0].pp()}`
        );

        return factory.makeIdentifierFor(
            transpiledUserFun.vParameters.vParameters[spec.defSite[1]]
        );
    }

    // User function itself
    if (spec.defSite instanceof SUserFunctionDefinition) {
        const instrCtx = transCtx.instrCtx;
        const transpiledUserFun = instrCtx.userFunctions.get(spec.defSite);
        assert(
            transpiledUserFun !== undefined,
            `Missing transpiled version of user function ${spec.defSite.pp()}`
        );

        return factory.makeIdentifierFor(transpiledUserFun);
    }

    // These should be removed by flattening
    if (spec.defSite === undefined || spec.defSite instanceof Array) {
        throw new Error(
            `Cannot generate AST for id ${spec.pp()} with no corrseponding definition.`
        );
    }

    // This identifier
    if (spec.defSite === "this") {
        return factory.makeIdentifier("<missing>", "this", (loc[1] as ContractDefinition).id);
    }

    // Normal solidity variable
    if (spec.defSite instanceof VariableDeclaration) {
        if (spec.name !== spec.defSite.name) {
            throw new Error(
                `Internal error: variable id ${spec.pp()} has different name from underlying variabl ${spec.defSite.print()}`
            );
        }

        return factory.makeIdentifierFor(spec.defSite);
    }

    // Function, Public Getter, Contract or Type name
    let referrencedDef:
        | FunctionDefinition
        | StructDefinition
        | EnumDefinition
        | ContractDefinition
        | VariableDeclaration;

    const specT = typeEnv.typeOf(spec);

    if (specT instanceof FunctionSetType) {
        referrencedDef = single(specT.definitions);
    } else if (specT instanceof UserDefinedType) {
        if (specT.definition === undefined) {
            throw new Error(
                `Id ${spec.pp()} of user defined type ${specT.pp()} is missing a definition.`
            );
        }

        referrencedDef = specT.definition;
    } else {
        throw new Error(`Unknown `);
    }

    return factory.makeIdentifierFor(referrencedDef);
}

export function generateExprAST(
    expr: SNode,
    transCtx: TranspilingContext,
    loc: STypingCtx
): Expression {
    const typeEnv = transCtx.typeEnv;
    const factory = transCtx.factory;

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
        return generateIdAST(expr, transCtx, loc);
    }

    if (expr instanceof SResult) {
        const scope = loc[loc.length - 1];
        assert(
            scope instanceof FunctionDefinition,
            `Internal Error: $result should appear only inside of function annotations.`
        );
        assert(
            scope.vReturnParameters.vParameters.length === 1,
            `Multiple return values should only occur in lets, and be removed by flattenExpr`
        );

        return factory.makeIdentifierFor(scope.vReturnParameters.vParameters[0]);
    }

    if (expr instanceof SIndexAccess) {
        const base = generateExprAST(expr.base, transCtx, loc);
        const index = generateExprAST(expr.index, transCtx, loc);

        return factory.makeIndexAccess("<missing>", base, index);
    }

    if (expr instanceof SMemberAccess) {
        const base = generateExprAST(expr.base, transCtx, loc);
        const type = typeEnv.typeOf(expr);

        let referencedDeclaration = -1;

        if (type instanceof FunctionSetType) {
            referencedDeclaration = type.definitions[0].id;
        } else if (type instanceof UserDefinedType && type.definition) {
            referencedDeclaration = type.definition.id;
        }

        return factory.makeMemberAccess("<missing>", base, expr.member, referencedDeclaration);
    }

    if (expr instanceof SUnaryOperation) {
        if (expr.op === "old") {
            throw Error(`old operators should have been removed by flattening: ${expr.pp()}`);
        }

        const subExp = generateExprAST(expr.subexp, transCtx, loc);

        return factory.makeUnaryOperation("<missing>", true, expr.op, subExp);
    }

    if (expr instanceof SBinaryOperation) {
        const left = generateExprAST(expr.left, transCtx, loc);
        const right = generateExprAST(expr.right, transCtx, loc);

        if (expr.op === "==>") {
            const notPrecedent = factory.makeUnaryOperation("missing", true, "!", left);

            return factory.makeBinaryOperation("<missing>", "||", notPrecedent, right);
        }

        return factory.makeBinaryOperation("<missing>", expr.op, left, right);
    }

    if (expr instanceof SConditional) {
        const condition = generateExprAST(expr.condition, transCtx, loc);
        const trueExp = generateExprAST(expr.trueExp, transCtx, loc);
        const falseExp = generateExprAST(expr.falseExp, transCtx, loc);

        return factory.makeConditional("<missing>", condition, trueExp, falseExp);
    }

    if (expr instanceof SFunctionCall) {
        const calleeT = typeEnv.typeOf(expr.callee);

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
                    generateTypeAst(calleeT.type, factory) as ElementaryTypeName
                );
            }
        } else {
            // Normal function call
            callee = generateExprAST(expr.callee, transCtx, loc);

            if (
                callee instanceof Identifier &&
                callee.vReferencedDeclaration instanceof FunctionDefinition &&
                callee.vReferencedDeclaration.visibility === FunctionVisibility.External
            ) {
                callee = factory.makeMemberAccess(
                    "<missing>",
                    factory.makeIdentifier("<missing>", "this", (loc[1] as ContractDefinition).id),
                    callee.name,
                    callee.vReferencedDeclaration.id
                );
            }
        }

        const args = expr.args.map((arg) => generateExprAST(arg, transCtx, loc));

        return factory.makeFunctionCall("<mising>", kind, callee, args);
    }

    if (expr instanceof SLet) {
        throw new Error(`let's should have been removed by flattening: ${expr.pp()}`);
    }

    if (expr instanceof TypeNode) {
        return generateTypeAst(expr, factory);
    }

    throw new Error(`NYI transpiling node ${expr.pp()}`);
}
