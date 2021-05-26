// Need the ts-nocheck to suppress the noUnusedLocals errors in the generated parser
// @ts-nocheck
import bigInt from "big-integer";
import {
    SId,
    SNode,
    SNumber,
    SBooleanLiteral,
    SHexLiteral,
    SStringLiteral,
    SUnaryOperation,
    UnaryOperator,
    SBinaryOperation,
    MultiplicativeBinaryOperator,
    AdditiveBinaryOperator,
    ShiftBinaryOperator,
    SMemberAccess,
    SIndexAccess,
    SFunctionCall,
    SForAll,
    SConditional,
    SLet,
    SMemberAccess,
    Range,
    SAddressLiteral,
    SResult,
    SProperty,
    AnnotationType,
    SUserFunctionDefinition,
    SAnnotation,
    SIfUpdated,
    SIfAssigned
} from "./ast";
import {
    BoolType,
    AddressType,
    IntType,
    FixedBytesType,
    BytesType,
    StringType,
    UserDefinedType,
    ArrayType,
    MappingType,
    PointerType,
    FunctionType,
    resolveAny,
    ASTNodeConstructor,
    ASTNode,
    ContractDefinition,
    StructDefinition,
    EnumDefinition
} from "solc-typed-ast"
import { assert } from "../util/misc";

function buildBinaryExpression(head: SNode, tail: Array<[string, SNode]>, src?: Range): SNode {
    return tail.reduce((acc, [whiteSp, curOp, whiteSP, curVal]) =>
        new SBinaryOperation(acc, curOp, curVal, src), head);
}

export function parseAnnotation(str: string, ctx: ASTNode, version: string): SAnnotation {
    return parse(str, { startRule: "Annotation", ctx, version});
}

export function parseExpression(str: string, ctx: ASTNode, version: string): SNode {
    return parse(str, { startRule: "Expression", ctx, version});
}

function makeUserDefinedType(
    name: string,
    options: { version: string, ctx: ASTNode, [others: string]: any },
    location: any
): UserDefinedType {
    const version = options.version;
    const ctx = options.ctx;
    const defs = [...resolveAny(name, ctx, version)];

    if (defs.length === 0) {
        throw new Error(`Couldn't find ${constructor.name} ${name}`);
    }

    if (defs.length > 1) {
        throw new Error(`Multiple matches for ${constructor.name} ${name}`);
    }

    const def = defs[0];

    assert(
        def instanceof ContractDefinition ||
        def instanceof StructDefinition ||
        def instanceof EnumDefinition,
        `Expected ${name} to be a type name not ${def.constructor.name}`)

    return new UserDefinedType(name, def, location);
}
