// Need the ts-nocheck to suppress the noUnusedLocals errors in the generated parser
import bigInt from "big-integer";
import {
    SId,
    SNode,
    SNumber,
    SBooleanLiteral,
    SHexLiteral,
    SStringLiteral,
    SUnaryOperation,
    // @ts-ignore
    UnaryOperator,
    SBinaryOperation,
    // @ts-ignore
    MultiplicativeBinaryOperator,
    // @ts-ignore
    AdditiveBinaryOperator,
    // @ts-ignore
    ShiftBinaryOperator,
    SIndexAccess,
    SFunctionCall,
    SForAll,
    SConditional,
    SLet,
    SMemberAccess,
    SAddressLiteral,
    SResult,
    SProperty,
    AnnotationType,
    SUserConstantDefinition,
    SUserFunctionDefinition,
    SAnnotation,
    SIfUpdated,
    SIfAssigned,
    SMacro,
    BinaryOperator,
    SLetAnnotation,
    STryAnnotation,
    // @ts-ignore
    RelationalBinaryOperator
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
    ASTNode,
    ContractDefinition,
    StructDefinition,
    EnumDefinition,
    FunctionVisibility,
    FunctionStateMutability,
    assert,
    DataLocation,
    UserDefinedValueTypeDefinition,
    InferType
} from "solc-typed-ast"
import { makeRange, adjustRange, PegsRange, LocOptions } from "../util/location"
import { SourceFile } from "../util/sources";
import { IdxToOffMap, makeIdxToOffMap } from "../util";

const srcloc = require("src-location")

export type ExprParseOptions = {
    startRule: string,
    ctx: ASTNode,
    inference: InferType,
    file: SourceFile,
    baseOff: number,
    baseLine: number,
    baseCol: number,
    idxToOffMap: IdxToOffMap
}

function buildBinaryExpression(
    head: SNode,
    tail: Array<[BinaryOperator, SNode, PegsRange]>,
    headRange: PegsRange,
    opts: ExprParseOptions): SNode
{
    return tail.reduce((acc, [curOp, curVal, curLoc]) =>
        new SBinaryOperation(acc, curOp, curVal, makeRange({start: headRange.start, end: curLoc.end})), head);
}

function adjustNodeSrcs(nd: SNode, opts: LocOptions) {
    nd.walk((child) => {
        if (child.src === undefined || child.src instanceof Array) {
            return;
        }

        adjustRange(child.src, opts)
    })
}

export function parseAnnotation(
    str: string,
    ctx: ASTNode,
    inference: InferType,
    file: SourceFile,
    baseOff: number): SAnnotation
{
    const { line, column } = srcloc.indexToLocation(file.contents, baseOff);
    // @ts-ignore
    const parseOpts = { startRule: "Annotation", ctx, inference };
    const nd = parse(str, parseOpts);

    const locOpts: LocOptions = {
        file, 
        baseOff,
        baseLine: line - 1,
        baseCol: column,
        idxToOffMap: makeIdxToOffMap(str)
    }

    adjustNodeSrcs(nd, locOpts);

    return nd;
}

export function parseExpression(
    str: string,
    ctx: ASTNode,
    inference: InferType,
    file: SourceFile,
    baseOff: number): SNode
{
    const { line, column } = srcloc.indexToLocation(file.contents, baseOff);
    // @ts-ignore
    const parseOpts = { startRule: "Expression", ctx, inference }
    const nd = parse(str, parseOpts);

    const locOpts: LocOptions = {
        file,
        baseOff,
        baseLine: line - 1,
        baseCol: column,
        idxToOffMap: makeIdxToOffMap(str)
    }

    adjustNodeSrcs(nd, locOpts);

    return nd;
}

function makeUserDefinedType(
    name: string,
    options: ExprParseOptions,
    location: any
): UserDefinedType {
    const defs = [...resolveAny(name, options.ctx, options.inference, true)];

    if (defs.length === 0) {
        throw new Error(`Couldn't find ${name}`);
    }

    if (defs.length > 1) {
        throw new Error(`Multiple matches for ${name}`);
    }

    const def = defs[0];

    assert(
        def instanceof ContractDefinition ||
        def instanceof StructDefinition ||
        def instanceof EnumDefinition ||
        def instanceof UserDefinedValueTypeDefinition,
        `Expected ${name} to be a type name, not ${def.type}`
    );

    return new UserDefinedType(name, def, location);
}

export function getFunctionAttributes(rawAttrList: string[]): [FunctionVisibility, FunctionStateMutability] {
    let visibility = FunctionVisibility.Public;
    let mutability = FunctionStateMutability.NonPayable;

    for (let attr of rawAttrList) {
        if (
            attr === FunctionVisibility.External ||
            attr === FunctionVisibility.Internal ||
            attr === FunctionVisibility.Private ||
            attr === FunctionVisibility.Public
        ) {
            visibility = attr;
        } else if (
            attr === FunctionStateMutability.Constant ||
            attr === FunctionStateMutability.NonPayable ||
            attr === FunctionStateMutability.Payable ||
            attr === FunctionStateMutability.Pure ||
            attr === FunctionStateMutability.View
        ) {
            mutability = attr;
        } else {
            assert(false, `Unknown attribute {0}`, attr);
        }
    }

    return [visibility, mutability];
}

// Dummy references to shut up tsc's unused expression warnings
bigInt; 
SId;
SNode;
SNumber;
SBooleanLiteral;
SHexLiteral;
SStringLiteral;
SUnaryOperation;
SIndexAccess;
SFunctionCall;
SForAll;
SConditional;
SLet;
SMemberAccess;
SAddressLiteral;
SResult;
SProperty;
AnnotationType;
SUserConstantDefinition;
SUserFunctionDefinition;
SAnnotation;
SIfUpdated;
SIfAssigned;
SMacro;
BoolType;
AddressType;
IntType;
FixedBytesType;
BytesType;
StringType;
UserDefinedType;
ArrayType;
MappingType;
PointerType;
FunctionType;
resolveAny;
FunctionStateMutability;
makeRange;
buildBinaryExpression;
makeUserDefinedType;
SLetAnnotation;
STryAnnotation;
DataLocation;
