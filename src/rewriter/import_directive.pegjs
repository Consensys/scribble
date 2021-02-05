Start =
    __ directive: ImportDirective __ { return directive; }

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

IMPORT = "import"
AS = "as"
FROM = "from"
SEMI = ";"
STAR = "*"
LBRACE = "{"
RBRACE = "}"
COMMA = ","

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
    id:([a-zA-Z_][a-zA-Z0-9_]*) {return text(); }

Symbol = 
    name: (Identifier) alias: (__ AS __ Identifier)? { return { name, alias: alias[3] } as SymbolDesc }

SymbolList =
    head: Symbol
    tail: ( __ COMMA __ Symbol)* {
        return tail.reduce((acc, el) => { acc.push(el[3]); return acc; }, [head])
    }

ImportDirective
    = IMPORT __ path: StringLiteral __ SEMI { return { path, unitAlias: undefined, symbolAliases: [] } as ImportDirectiveDesc; }
    / IMPORT __ path: StringLiteral __ AS __ unitAlias: Identifier __ SEMI { return { path, unitAlias, symbolAliases: [] } as ImportDirectiveDesc; }
    / IMPORT __ STAR __ AS __ unitAlias: Identifier __ FROM __ path: StringLiteral __ SEMI { return { path, unitAlias, symbolAliases: [] } as ImportDirectiveDesc; }
    / IMPORT __ LBRACE __ symbolAliases: SymbolList __ RBRACE __ FROM __ path: StringLiteral __ SEMI { return { symbolAliases, path, unitAlias: undefined } as ImportDirectiveDesc; }
