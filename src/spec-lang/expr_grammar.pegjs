Start
    = StartingWhiteSpace  expression: Expression __ { return expression; }

// Terminals

PrimitiveWhiteSpace "whitespace"
  = "\t"
  / "\v"
  / "\f"
  / " "
  / "\u00A0"
  / "\uFEFF"
  / Zs

WhiteSpace "whitespace"
  = PrimitiveWhiteSpace
  / LineTerminator PrimitiveWhiteSpace* ("*" / "///")

StartingWhiteSpace "whitespace"
  = PrimitiveWhiteSpace* LineTerminator? PrimitiveWhiteSpace* ("*" / "///")? __ 

// Separator, Space
Zs = [\u0020\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]

LineTerminator
  = [\n\r\u2028\u2029]

LineTerminatorSequence "end of line"
  = "\n"
  / "\r\n"
  / "\r"
  / "\u2028"
  / "\u2029"

__
  = (WhiteSpace / LineTerminator)*

TRUE = "true"
FALSE = "false"
OLD = "old"
LET = "let"
IN = "in"
BOOL = "bool"
HEX = "hex"
ADDRESS = "address"
PAYABLE = "payable"
BYTES = "bytes"
STRING = "string"
BYTE = "byte"
MEMORY = "memory"
STORAGE = "storage"
CALLDATA = "calldata"
MAPPING = "mapping"
FUNCTION = "function"
RETURNS = "returns"
EXTERNAL = "external"
INTERNAL = "internal"
PURE = "pure"
VIEW = "view"
NONPAYABLE = "nonpayable"
RESULT = "$result"

Keyword
    = TRUE
    / FALSE
    / OLD
    / LET
    / IN
    / BOOL
    / HEX
    / ADDRESS
    / PAYABLE
    / BYTES
    / BYTE
    / MEMORY
    / STORAGE
    / CALLDATA
    / STRING
    / MAPPING
    / FUNCTION
    / RETURNS
    / EXTERNAL
    / INTERNAL
    / PURE
    / VIEW
    / NONPAYABLE
    / RESULT

// expression

Expression =
    LetExpression

Identifier =
    !(Keyword ![a-zA-Z0-9_]) id:([a-zA-Z_][a-zA-Z0-9_]*) {return new SId(text(), location());}

HexDigit
    = [0-9a-f]i

HexNumber =
    "0x"i digits: HexDigit+ {
      const num = digits.join('');

      // 20-byte hex literals are implicitly treated as address constants.
      if (digits.length === 40) {
        return new SAddressLiteral('0x' + num, location())
      } else {
        return new SNumber(bigInt(digits.join(''), 16), 16, text(), location())
      }
    }

DecDigit
    = [0-9]

ExponentIndicator
  = "e"i

SignedInteger
  = [+-]? DecDigit+

ExponentPart
    = ExponentIndicator SignedInteger

DecNumber =
    DecDigit+ ExponentPart? { return new SNumber(bigInt(text()), 10, location()); }

Number =
    HexNumber / DecNumber

BooleanLiteral =
    val: (TRUE / FALSE) { return new SBooleanLiteral(text() == "true", location())}

HexLiteral
    = HEX '"' val: HexDigit* '"' { return new SHexLiteral(val.join(""), location()) }
    / HEX "'" val: HexDigit* "'" { return new SHexLiteral(val.join(""), location()) }

StringLiteral
    = "'" chars: SingleStringChar* "'" { return new SStringLiteral(chars.join(""), location()) }
    / '"' chars: DoubleStringChar* '"' { return new SStringLiteral(chars.join(""), location()) }

AnyChar
    = .

DoubleStringChar
    = !('"' / "\\" / LineTerminator) AnyChar { return text(); }
    / "\\" sequence: EscapeSequence { return sequence; }
    / LineContinuation

SingleStringChar
    = !("'" / "\\" / LineTerminator) AnyChar { return text(); }
    / "\\" sequence: EscapeSequence { return sequence; }
    / LineContinuation

LineContinuation
    = "\\" LineTerminatorSequence { return ""; }

EscapeSequence
    = CharEscapeSequence
    / "0" !DecDigit { return "\0"; }
    / HexEscapeSequence
    / UnicodeEscapeSequence

CharEscapeSequence
    = SingleEscapeChar
    / NonEscapeChar

SingleEscapeChar
    = "'"
    / '"'
    / "\\"
    / "b"  { return "\b"; }
    / "f"  { return "\f"; }
    / "n"  { return "\n"; }
    / "r"  { return "\r"; }
    / "t"  { return "\t"; }
    / "v"  { return "\v"; }

NonEscapeChar
    = !(EscapeChar / LineTerminator) AnyChar { return text(); }

EscapeChar
    = SingleEscapeChar
    / DecDigit
    / "x"
    / "u"

HexEscapeSequence
    = "x" digits:$(HexDigit HexDigit) { return String.fromCharCode(parseInt(digits, 16)); }

UnicodeEscapeSequence
    = "u" digits:$(HexDigit HexDigit HexDigit HexDigit) { return String.fromCharCode(parseInt(digits, 16)); }

PrimaryExpression =
    HexLiteral / Identifier / Number / BooleanLiteral / StringLiteral / ("(" __ expr: Expression __ ")" { return expr; }) / (RESULT {return new SResult(location());})

OldExpression
= OLD __ "(" __ expr: Expression __ ")" { return new SUnaryOperation("old", expr, location()); }
  / PrimaryExpression

MemberAccessExpression =
    head: (OldExpression / Type)
    tail: (
        __ "." __ property: Identifier { return {property: property };}
      / __ "[" __ index: Expression __ "]" { return {index: index };}
      / "(" __ args: ArgumentList? __ ")" { return {callArgs: args} ; }
    )* {
      return tail.reduce(
        (acc, el) => {
          if (el.hasOwnProperty("index")) {
            return new SIndexAccess(acc, el.index, location());
          } else if (el.hasOwnProperty("property")) {
            return new SMemberAccess(acc, el.property.name, location());
          } else {
            const args = el.callArgs === null ? [] : el.callArgs;
            return new SFunctionCall(acc, args, location());
          }
        },
        head
      )
    }

ArgumentList =
    head: (Expression)
    tail: (__ "," __ expr: Expression)*
    {
      return tail.reduce((acc, el) => { acc.push(el[3]); return acc; }, [head]);
    }

UnaryExpression =
    (operator: UnaryOperator __ subexp: UnaryExpression {
        return new SUnaryOperation(operator as UnaryOperator, subexp, location());
    })
    / MemberAccessExpression

UnaryOperator =
    "-" / "!"

PowerExpression
  = head: UnaryExpression
    tail: (__ op: "**" __ UnaryExpression)* {
        return buildBinaryExpression(head, tail, location());
    }

MultiplicativeOperator
  = $("*") { return text() as MultiplicativeBinaryOperator; }
  / $("/") { return text() as MultiplicativeBinaryOperator; }
  / $("%") { return text() as MultiplicativeBinaryOperator; }

MultiplicativeExpression
  = head: PowerExpression
    tail: (__ op: MultiplicativeOperator __ PowerExpression)* {
        return buildBinaryExpression(head, tail, location());
    }

AdditiveOperator
  = $("+") { return text() as AdditiveBinaryOperator; }
  / $("-") { return text() as AdditiveBinaryOperator; }

AdditiveExpression
  = head:MultiplicativeExpression
    tail:(__ AdditiveOperator __ MultiplicativeExpression)*
    { return buildBinaryExpression(head, tail, location()); }

ShiftExpression
  = head:AdditiveExpression
    tail:(__ ShiftOperator __ AdditiveExpression)*
    { return buildBinaryExpression(head, tail, location()); }

ShiftOperator
  = $("<<") { return text() as ShiftBinaryOperator; } 
  / $(">>") { return text() as ShiftBinaryOperator; }

BitwiseANDExpression
  = head:ShiftExpression
    tail:(__ "&" __ ShiftExpression)*
    { return buildBinaryExpression(head, tail, location()); }

BitwiseXORExpression
  = head:BitwiseANDExpression
    tail:(__ "^" __ BitwiseANDExpression)*
    { return buildBinaryExpression(head, tail, location()); }

BitwiseORExpression
  = head:BitwiseXORExpression
    tail:(__ "|" __ BitwiseXORExpression)*
    { return buildBinaryExpression(head, tail, location()); }

RelationalExpression
  = (left: BitwiseORExpression __ op: RelationalOperator __ right: BitwiseORExpression { return new SBinaryOperation(left, op as RleationalBinaryOperator, right, location()); }) 
  / BitwiseORExpression

RelationalOperator
  = '<=' { return text(); }
  / '>=' { return text(); }
  / '<' { return text(); }
  / '>' { return text(); }

EqualityExpression
  = head:RelationalExpression
    tail:(__ EqualityOperator __ RelationalExpression)*
    { return buildBinaryExpression(head, tail, location()); }
  
EqualityOperator
  = "==" { return text(); }
  / "!=" { return text(); }

LogicalANDExpression
  = head:EqualityExpression
    tail:(__ "&&" __ EqualityExpression)*
    { return buildBinaryExpression(head, tail, location()); }

LogicalORExpression
  = head:LogicalANDExpression
    tail:(__ "||" __ LogicalANDExpression)*
    { return buildBinaryExpression(head, tail, location()); }

ImplicationExpression
  = precedent: LogicalORExpression 
    tail: (__ "==>" __  ImplicationExpression)*
    { return buildBinaryExpression(precedent, tail, location()); }

ConditionalExpression =
    head: ImplicationExpression
    tail: (__ "?" __ trueE: Expression __ ":" __ falseE: Expression { return [trueE, falseE]; })*
    {
      return tail.reduce(
        (acc, [trueE, falseE]) => {
          return new SConditional(acc, trueE, falseE, location());
        },
        head
      )
    }
  
LetExpression
  = LET __ bindings:LhsBindings __ ":=" __ rhs: Expression __ IN __ inExp:Expression { return new SLet(bindings, rhs, inExp, location()); }
  / ConditionalExpression

LhsBindings
  = head: Identifier __ tail:("," __ id: Identifier __ { return id; })* { return tail.reduce((acc, cur) => {acc.push(cur); return acc;}, [head]); }

Type = FunctionType

SimpleType
  = BoolType
  / AddressType
  / IntType
  / BytesType
  / FixedSizeBytesType
  / StringType
  / UserDefinedType

BoolType = BOOL { return new SBoolType(location()) }
AddressType = ADDRESS __ payable:(PAYABLE?) { return new SAddressType(payable !== null, location())}
IntType = unsigned:("u"?) "int" width:(Number?) { 
  const signed = unsigned === null;
  const bitWidth = width === null ? 256 : width;
  return new SIntType(bitWidth, signed, location());
}
FixedSizeBytesType
  = BYTES width:Number { return new SFixedBytes(width, location()); }
  / BYTE { return new SFixedBytes(1, location()); }

BytesType = BYTES !Number { return new SBytes(location()); }
StringType = STRING { return new SString(location()); }

UserDefinedType
  = base: Identifier "." field: Identifier { return new SUserDefinedType(`${base.name}.${field.name}`, location()); }
  / name: Identifier  { return new SUserDefinedType(name.name, location()); }

ArrayType
  = head: SimpleType tail: ( __ "[" __ size: Number? __ "]")* {
    return tail.reduce((acc, cur) => {
      const size = cur[3];
      return new SArrayType(acc, size !== null ? size : undefined, location());
    }, head)
  }

MappingType
  = MAPPING __ "(" __ keyType: SimpleType __ "=>" __ valueType: MappingType __ ")" { return new SMappingType(keyType, valueType, location()); }
  / ArrayType

DataLocation = MEMORY / STORAGE / CALLDATA
PointerType = toType: MappingType __ location: (DataLocation?) {
  return location === null ? toType : new SPointer(toType, location as DataLocation, location());
}

TypeList
  = head: PointerType tail: (__ "," __ PointerType)* { return tail.reduce((acc, cur)=> { acc.push(cur[3]); return acc; }, [head]) }


FunctionVisibility = EXTERNAL / INTERNAL
FunctionMutability = PURE / VIEW / PAYABLE / NONPAYABLE
FunctionDecorator = FunctionVisibility / FunctionMutability

FunctionDecoratorList
  = head: FunctionDecorator tail: (__ FunctionDecorator)* { return tail.reduce((acc, cur) => { acc.push(cur[1]); return acc}, [head])}

FunctionType
  = FUNCTION __ "(" __ args: TypeList? __ ")" __ decorators: (FunctionDecoratorList?) __ returns:(RETURNS __ "(" __ (TypeList) __ ")")? {
    const argTs = args === null ? [] : args;
    const retTs = returns === null ? [] : returns[4];
    decorators = decorators === null ? [] : decorators;

    const [visibility, mutability] = getFunctionAttrbiutes(decorators);
    return new SFunctionType(argTs, retTs, visibility, mutability, location());
  }
  / PointerType