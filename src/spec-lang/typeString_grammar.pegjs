Start
    = __  type: Type __ { return type; }

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
INT_CONST = "int_const"
RATIONAL_CONST = "rational_const"
POINTER = "pointer"
REF = "ref"
TUPLE = "tuple"
TYPE = "type"
LITERAL_STRING = "literal_string"
MODIFIER = "modifier"
CONTRACT = "contract"
SUPER = "super"
LIBRARY = "library"
STRUCT = "struct"
ENUM = "enum"
MSG = "msg"
ABI = "abi"
BLOCK = "block"
TX = "tx"
SLICE = "slice"
CONSTANT = "constant"

Keyword
    = TRUE
    / FALSE
    / OLD
    / LET
    / IN
    / BOOL
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
    / INT_CONST
    / RATIONAL_CONST 
    / TUPLE
    / TYPE
    / LITERAL_STRING
    / MODIFIER
    / CONTRACT
    / SUPER
    / LIBRARY
    / STRUCT
    / ENUM 
    / MSG
    / ABI
    / BLOCK
    / SLICE
    / TX
    / CONSTANT

StringLiteral
    = "'" chars: SingleStringChar* "'" { return chars.join(""); }
    / '"' chars: DoubleStringChar* '"' { return chars.join(""); }

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

HexDigit
    = [0-9a-f]i

DecDigit
    = [0-9]

EscapeChar
    = SingleEscapeChar
    / DecDigit
    / "x"
    / "u"

HexEscapeSequence
    = "x" digits:$(HexDigit HexDigit) { return String.fromCharCode(parseInt(digits, 16)); }

UnicodeEscapeSequence
    = "u" digits:$(HexDigit HexDigit HexDigit HexDigit) { return String.fromCharCode(parseInt(digits, 16)); }

Identifier =
    !(Keyword [^a-zA-Z0-9_]) id:([a-zA-Z_][a-zA-Z$0-9_]*) { return text(); }

Word =
    id:([a-zA-Z_][a-zA-Z0-9$_]*) { return text(); }

Number =
    [0-9]+ { return parseInt(text()); }

MaybeNegNumber =
    sign: ("-"?) __ num: Number { return sign !== null ? -num : num; }


SimpleType
  = BoolType
  / AddressType
  / IntLiteralType
  / RationalLiteralType
  / StringLiteralType
  / IntType
  / BytesType
  / FixedSizeBytesType
  / StringType
  / UserDefinedType

StringLiteralErrorMsg = "(" [^\)]* ")"
StringLiteralType = LITERAL_STRING __ (StringLiteral / StringLiteralErrorMsg) { return new SStringLiteralType(); }
IntLiteralType = INT_CONST __ prefix: MaybeNegNumber ("...(" [^\)]* ")..." Number)? { return new SIntLiteralType(); }
RationalLiteralType = RATIONAL_CONST __ numerator: MaybeNegNumber __ "/" __ denominator: Number { throw new Error(`NYI Int literal type: ${text()}`); }

BoolType = BOOL { return new SBoolType(); }
AddressType = ADDRESS __ payable:(PAYABLE?) { return new SAddressType(payable !== null); }
IntType = unsigned:("u"?) "int" width:(Number?) {
  const signed = unsigned === null;
  const bitWidth = width === null ? 256 : width;
  return new SIntType(bitWidth, signed);
}

FixedSizeBytesType
  = BYTES width:Number { return new SFixedBytes(width); }
  / BYTE               { return new SFixedBytes(1); }

BytesType = BYTES !Number { return new SBytes(); }
StringType = STRING       { return new SString(); }

FQName
  = Identifier ( "." Word )* { return text(); }

UserDefinedType
  = STRUCT __ name: FQName              { return new SUserDefinedType(name); }
  / ENUM __ name: FQName                { return new SUserDefinedType(name); }
  / CONTRACT __ SUPER? __ name: FQName  { return new SUserDefinedType(name); }
  / LIBRARY __ name: FQName             { return new SUserDefinedType(name); }

MappingType
  = MAPPING __ "(" __ keyType: ArrayPtrType __ "=>" __ valueType: Type __ ")"  { return new SMappingType(keyType, valueType); }

DataLocation = MEMORY / STORAGE / CALLDATA
PointerType = POINTER / REF / SLICE

TypeList
  = head: Type tail: (__ "," __ Type)*   { return tail.reduce((lst, cur) => { lst.push(cur[3]); return lst; }, [head]); }
  / __                                   { return []; }

MaybeTypeList
  = head: Type? &(__ ",") tail: (__ "," __ Type?)* { return tail.reduce((lst, cur) => { lst.push(cur[3]); return lst; }, [head]); }
  / __                                             { return []; }

FunctionVisibility = EXTERNAL / INTERNAL
FunctionMutability = PURE / VIEW / PAYABLE / NONPAYABLE / CONSTANT
FunctionDecorator = FunctionVisibility / FunctionMutability

FunctionDecoratorList
  = head: FunctionDecorator tail: (__ FunctionDecorator)* { return tail.reduce((acc, cur) => { acc.push(cur[1]); return acc}, [head])}

FunctionType
  = FUNCTION __ "(" __ args: TypeList? __ ")" __ decorators: (FunctionDecoratorList?) __ returns:(RETURNS __ "(" __ TypeList __ ")")? { 
    const retTypes = returns === null ? [] : returns[4];
    const [visibility, mutability] = getFunctionAttributes(decorators !== null ? decorators : []);
    return new SFunctionType(args, retTypes, visibility, mutability);
}

SelectorType
  = FUNCTION __ FQName __ "(" __ args: TypeList? __ ")" __ decorators: (FunctionDecoratorList?) __ (RETURNS __ "(" __ (returns:TypeList) __ ")")? { return SFixedBytes(4); }


ModifierType
  = MODIFIER __ "(" __ args: TypeList? __ ")" { throw new Error(`Shouldn't try to type Modifiers!`); }

TupleType
  = TUPLE __ "(" __  elements: MaybeTypeList __ ")" { return new STupleType(elements); }

TypeExprType
  = TYPE __ "(" innerT: Type ")" { throw new Error(`NYI type expr types: ${text()}`); }

BuiltinTypes
  = name: MSG     { throw new Error(`NYI builtin types: ${text()}`); }
  / name: ABI     { throw new Error(`NYI builtin types: ${text()}`); }
  / name: BLOCK   { throw new Error(`NYI builtin types: ${text()}`); }
  / name: TX      { throw new Error(`NYI builtin types: ${text()}`); }

NonArrPtrType
  = MappingType
  / SimpleType
  / FunctionType
  / SelectorType

ArrayPtrType
  = head: NonArrPtrType tail: ( __ !PointerType "[" __ size: Number? __ "]" / __ storageLocation: (DataLocation) pointerType: (__ PointerType)?)*  {
    return tail.reduce((acc, cur) => {
      if (cur.length > 3) {
        const size = cur[4];
        return new SArrayType(acc, size !== null ? size : undefined);
      } else {
        const location = cur[1] as DataLocation;
        return new SPointer(acc, location);
      }
    }, head)
  }

// Top-level rule
Type
  = ModifierType
  / TypeExprType
  / TupleType
  / BuiltinTypes
  / ArrayPtrType
