import {
    ASTNodeFactory,
    ContractDefinition,
    ElementaryTypeName,
    EnumDefinition,
    Expression,
    FunctionCallKind,
    FunctionDefinition,
    LiteralKind,
    StructDefinition,
    TypeName,
    VariableDeclaration
} from "@consensys/solc-typed-ast";
import {
    SAddressType,
    SArrayType,
    SBinaryOperation,
    SBooleanLiteral,
    SBoolType,
    SBytes,
    SConditional,
    SFixedBytes,
    SFunctionCall,
    SFunctionSetType,
    SHexLiteral,
    SId,
    SIndexAccess,
    SIntLiteralType,
    SIntType,
    SLet,
    SMemberAccess,
    SNode,
    SNumber,
    SPointer,
    SBuiltinTypeNameType,
    SString,
    SStringLiteral,
    STupleType,
    SType,
    SUserDefinedTypeNameType,
    SUnaryOperation,
    SUserDefinedType,
    SAddressLiteral,
    SResult
} from "../spec-lang/ast";
import { BuiltinSymbols, STypingCtx, TypeMap } from "../spec-lang/tc";
import { assert, single } from "../util";

export function generateTypeAst(type: SType, factory: ASTNodeFactory): TypeName {
    if (
        type instanceof STupleType ||
        type instanceof SUserDefinedTypeNameType ||
        type instanceof SIntLiteralType ||
        type instanceof SFunctionSetType
    ) {
        throw new Error(`Unsupported spec type ${type.pp()}`);
    }

    if (
        type instanceof SAddressType ||
        type instanceof SBoolType ||
        type instanceof SBytes ||
        type instanceof SFixedBytes ||
        type instanceof SIntType ||
        type instanceof SString
    ) {
        return factory.makeElementaryTypeName(`<missing>`, type.pp());
    }

    if (type instanceof SPointer) {
        return generateTypeAst(type.to, factory);
    }

    if (type instanceof SUserDefinedType) {
        if (type.definition === undefined) {
            throw new Error(`Missing definition for user defined type ${type.pp()}`);
        }

        return factory.makeUserDefinedTypeName("<missing>", type.pp(), type.definition.id);
    }

    if (type instanceof SArrayType) {
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

export function generateIdAST(
    spec: SId,
    typing: TypeMap,
    factory: ASTNodeFactory,
    loc: STypingCtx
): Expression {
    if (BuiltinSymbols.has(spec.name)) {
        return factory.makeIdentifier("<missing>", spec.name, -1);
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

    const specT = typing.get(spec) as SType;

    if (specT instanceof SFunctionSetType) {
        referrencedDef = single(specT.definitions);
    } else if (specT instanceof SUserDefinedType) {
        if (specT.definition === undefined) {
            throw new Error(
                `Id ${spec.pp()} of user defined type ${specT.pp()} is missing a definition.`
            );
        }

        referrencedDef = specT.definition;
    } else if (specT instanceof SUserDefinedTypeNameType) {
        referrencedDef = specT.definition;
    } else {
        throw new Error(`Unknown `);
    }

    if (!(referrencedDef.name === spec.name)) {
        throw new Error(
            `Internal error: variable id ${spec.pp()} has different name from underlying variable ${referrencedDef.print()}`
        );
    }

    return factory.makeIdentifierFor(referrencedDef);
}

export function generateExprAST(
    expr: SNode,
    typing: TypeMap,
    factory: ASTNodeFactory,
    loc: STypingCtx
): Expression {
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
        return generateIdAST(expr, typing, factory, loc);
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
        const base = generateExprAST(expr.base, typing, factory, loc);
        const index = generateExprAST(expr.index, typing, factory, loc);

        return factory.makeIndexAccess("<missing>", base, index);
    }

    if (expr instanceof SMemberAccess) {
        const base = generateExprAST(expr.base, typing, factory, loc);
        const type = typing.get(expr);

        let referencedDeclaration = -1;

        if (type instanceof SFunctionSetType) {
            referencedDeclaration = type.definitions[0].id;
        } else if (type instanceof SUserDefinedType && type.definition) {
            referencedDeclaration = type.definition.id;
        }

        return factory.makeMemberAccess("<missing>", base, expr.member, referencedDeclaration);
    }

    if (expr instanceof SUnaryOperation) {
        if (expr.op === "old") {
            throw Error(`old operators should have been removed by flattening: ${expr.pp()}`);
        }

        const subExp = generateExprAST(expr.subexp, typing, factory, loc);

        return factory.makeUnaryOperation("<missing>", true, expr.op, subExp);
    }

    if (expr instanceof SBinaryOperation) {
        const left = generateExprAST(expr.left, typing, factory, loc);
        const right = generateExprAST(expr.right, typing, factory, loc);

        if (expr.op === "==>") {
            const notPrecedent = factory.makeUnaryOperation("missing", true, "!", left);

            return factory.makeBinaryOperation("<missing>", "||", notPrecedent, right);
        }

        return factory.makeBinaryOperation("<missing>", expr.op, left, right);
    }

    if (expr instanceof SConditional) {
        const condition = generateExprAST(expr.condition, typing, factory, loc);
        const trueExp = generateExprAST(expr.trueExp, typing, factory, loc);
        const falseExp = generateExprAST(expr.falseExp, typing, factory, loc);

        return factory.makeConditional("<missing>", condition, trueExp, falseExp);
    }

    if (expr instanceof SFunctionCall) {
        const calleeT = typing.get(expr.callee) as SType;

        let callee: Expression;

        if (calleeT instanceof SBuiltinTypeNameType) {
            callee = factory.makeElementaryTypeNameExpression(
                "<missing>",
                generateTypeAst(calleeT.type, factory) as ElementaryTypeName
            );
        } else if (calleeT instanceof SUserDefinedType) {
            assert(calleeT.definition !== undefined, ``);

            callee = factory.makeIdentifierFor(calleeT.definition);
        } else {
            callee = generateExprAST(expr.callee, typing, factory, loc);
        }

        const args = expr.args.map((arg) => generateExprAST(arg, typing, factory, loc));

        return factory.makeFunctionCall("<mising>", FunctionCallKind.FunctionCall, callee, args);
    }

    if (expr instanceof SLet) {
        throw new Error(`let's should have been removed by flattening: ${expr.pp()}`);
    }

    if (expr instanceof SType) {
        return generateTypeAst(expr, factory);
    }

    throw new Error(`NYI transpiling node ${expr.pp()}`);
}
