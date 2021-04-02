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
    SConditional,
    SLet,
    SBoolType,
    SAddressType,
    SIntType,
    SFixedBytes,
    SBytes,
    SPointer,
    SString,
    SArrayType,
    SMemberAccess,
    SUserDefinedType,
    SMappingType,
    SFunctionType,
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

function buildBinaryExpression(head: SNode, tail: Array<[string, SNode]>, src?: Range): SNode {
    return tail.reduce((acc, [whiteSp, curOp, whiteSP, curVal]) =>
        new SBinaryOperation(acc, curOp, curVal, src), head);
}

export function parseAnnotation(str: string): SAnnotation {
    return parse(str, { startRule: "Annotation"});
}

export function parseExpression(str: string): SNode {
    return parse(str, { startRule: "Expression"});
}