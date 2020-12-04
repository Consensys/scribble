Start
    = StartingWhiteSpace  annotation: Annotation __ .* { return annotation; }

// Annotation grammar
IF_SUCCEEDS="if_succeeds"
INVARIANT="invariant"
AnnotationType = IF_SUCCEEDS / INVARIANT

AnnotationStr
    = "'" chars: SingleStringChar* "'" { return chars.join("") }
    / '"' chars: DoubleStringChar* '"' { return chars.join("") }

AnnotationLabel = "{:msg" __  str:AnnotationStr __ "}" { return str; }
AnnotationBlob
    = ([^'";]+ / AnnotationStr)* { return [text(), location()]; }

Annotation = type: AnnotationType __ label: AnnotationLabel? __ expr: AnnotationBlob __ semi: ";"? {
  const [origExprStr, exprLoc] = expr;
  return [type, label, text(), location(), origExprStr, exprLoc, semi !== null];
}

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

DecDigit
    = [0-9]

HexDigit
    = [0-9a-f]i
