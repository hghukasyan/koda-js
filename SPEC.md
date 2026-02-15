# KODA Data Format (KDF) — Specification

**Full name:** Compact Object Data Architecture  
**Specification name:** KDF (KODA Data Format)  
**Version:** 1.0  
**Status:** Draft  

**npm package:** [koda-format](https://www.npmjs.com/package/koda-format)

---

## 1. Introduction

KODA (Compact Object Data Architecture) is a structured data format designed for storage efficiency, deterministic encoding, and human authorability. It has two representations:

- **Text format** (`.koda`): A compact, JSON-like syntax with minimal overhead, comments, and optional commas.
- **Binary format** (`.kod`): A canonical encoding optimized for storage, transport, and PostgreSQL BYTEA columns.

KODA addresses limitations of JSON (verbosity, no comments, non-deterministic key order), YAML (complexity, security issues), and binary formats like MessagePack (non-canonical, key repetition).

**Positioning:** KODA is a **compact binary data format** first. It is optimized for **smaller payloads**, **efficient storage**, **reduced IO**, and **fast binary encode/decode** - not for beating JSON on raw text parsing speed. In real systems, KODA wins on size, IO efficiency, storage, and scalability (see [README](https://github.com/hghukasyan/koda-format#readme)).

---

## 2. Design Goals

| Goal | Description |
|------|-------------|
| **Compactness** | Smaller than JSON; keys stored once per document in binary; minimal encoded size. |
| **Determinism** | Canonical encoding enables hashing, caching, and comparison. |
| **Safety** | Unambiguous parsing; secure against malformed and malicious input. |
| **Human-authorable** | Readable text format with comments and flexible syntax. |
| **Machine-efficient** | Efficient binary encode/decode; stream-friendly; low allocation; optional partial decode. |
| **Storage-friendly** | Suitable for PostgreSQL BYTEA; minimal disk footprint; reduced IO. |
| **Standardization** | Versioned format; forward-compatible extension points. |

---

## 3. Terminology

- **Document**: A single KODA value (object, array, or top-level scalar).
- **Value**: Any instance of the KODA data model (object, array, string, number, boolean, null).
- **Key**: A string used as an object property name.
- **Element**: A member of an array or a key-value pair in an object.
- **Canonical encoding**: The unique binary representation of a value under KDF rules.
- **Dictionary**: In binary format, the ordered set of unique keys used in the document.

---

## 4. Text Syntax (.koda)

### 4.1 Overview

- **Objects**: `{` ... `}`
- **Arrays**: `[` ... `]`
- **Key-value**: `key: value`
- **Separators**: Whitespace (and optional commas) separate elements; commas are optional.
- **Comments**: `//` (single-line) and `/*` `*/` (multi-line).
- **Trailing commas**: Allowed in objects and arrays.

### 4.2 EBNF Grammar

```ebnf
document     = value ;

value        = object | array | string | number | boolean | null ;

object       = "{" [ ( pair ( ws_or_comma pair )* [ ws_or_comma ] ) ] "}" ;
pair         = key ":" value ;
key          = identifier | quoted_string ;

array        = "[" [ ( value ( ws_or_comma value )* [ ws_or_comma ] ) ] "]" ;

string       = quoted_string | unquoted_string ;
quoted_string = double_quote_string | single_quote_string ;
double_quote_string = '"' ( escape | [^"\x00-\x1F] )* '"' ;
single_quote_string = "'" ( escape_single | [^'\x00-\x1F] )* "'" ;
unquoted_string = identifier ;  (* when value position allows *)

identifier   = ( letter | "_" ) ( letter | digit | "_" | "-" )* ;
letter       = "A" - "Z" | "a" - "z" ;
digit        = "0" - "9" ;

number       = integer | float ;
integer      = [ "-" ] ( "0" | digit_nonzero digit* ) ;
digit_nonzero = "1" - "9" ;
float        = [ "-" ] ( digit+ "." digit* | "." digit+ ) ( "e" | "E" ) [ "+" | "-" ] digit+ 
             | [ "-" ] digit+ "." digit* ;

boolean      = "true" | "false" ;
null         = "null" ;

ws_or_comma  = ( whitespace | comment )+ | ( "," ( whitespace | comment )* ) ;
whitespace   = " " | "\t" | "\r" | "\n" ;
comment      = "//" [^\n]* | "/*" ( [^*] | "*" [^/] )* "*/" ;

escape       = "\\" ( '"' | "\\" | "/" | "b" | "f" | "n" | "r" | "t" | "u" hex hex hex hex ) ;
escape_single = "\\" ( "'" | "\\" | "/" | "b" | "f" | "n" | "r" | "t" | "u" hex hex hex hex ) ;
hex          = digit | "A" - "F" | "a" - "f" ;
```

### 4.3 Lexical Rules

- **Unquoted keys**: Keys may be identifiers (letters, digits, `_`, `-`; must not start with digit). Reserved words `true`, `false`, `null` are allowed as keys (context is key vs value).
- **Unquoted string values**: Only in value position when the token is an identifier that is not `true`, `false`, or `null`; then it is interpreted as a string. Numbers (including those that look like integers) are always parsed as numbers when in value position.
- **String quotes**: Double `"` and single `'` supported; same escape rules as JSON for `"` strings; for `'` strings, `\'` and `\\` apply.
- **Numbers**: No leading zeros for integers (except `0`). Floats may use `e`/`E` exponent. Hex/octal not in scope for 1.0.
- **Whitespace**: Space, tab, CR, LF separate tokens. At least one whitespace or comma is required between adjacent values or pairs when otherwise ambiguous (e.g. `}` and `{`).

### 4.4 Example (Text)

```koda
// Config example
name: "my-app"
version: 1
enabled: true

vehicles[
  { id: A speed: 60 }
  { id: B speed: 40 }
]
```

---

## 5. Data Model

KODA values map to these types:

| Type    | Description | Text example |
|---------|-------------|--------------|
| Object  | Unordered map of string keys to values | `{ a: 1 b: 2 }` |
| Array   | Ordered list of values | `[ 1 2 3 ]` |
| String  | Unicode string | `"hello"` or `hello` (unquoted when safe) |
| Integer | Signed 64-bit range; parsed from text | `42`, `-1` |
| Float   | IEEE 754 double | `3.14`, `1e10` |
| Boolean | true / false | `true`, `false` |
| Null    | Null value | `null` |

**Note:** For canonical encoding, object key order is defined by the canonicalization rules (e.g. lexicographic by key).

---

## 6. Binary Encoding (.kod)

### 6.1 Overview

- **Deterministic**: Same value always produces the same byte sequence.
- **Key dictionary**: Each unique key appears once; values reference keys by index.
- **Stream-friendly**: Header, then dictionary, then data; can be parsed in one pass.

### 6.2 Layout

```
+--------+--------+------------------+------------------+
| Magic  | Version| Dictionary       | Data             |
| 4 B    | 1 B    | (see below)      | (see below)      |
+--------+--------+------------------+------------------+
```

- **Magic**: 4 bytes, `0x4B 0x4F 0x44 0x41` ("KODA" ASCII).
- **Version**: 1 byte. Current format version = `1`.

### 6.3 Dictionary Section

- **Dictionary length**: 4 bytes, unsigned big-endian, number of unique keys N.
- **Keys**: For each of N keys:
  - **Key length**: 4 bytes, unsigned big-endian, byte length L of key (UTF-8).
  - **Key bytes**: L bytes UTF-8.

Keys appear in **canonical order** (sorted lexicographically by UTF-8 bytes). Keys are deduplicated; first occurrence in document order defines the index (for building the dictionary during encoding).

### 6.4 Data Section

The root value is encoded as a single value. Values are encoded in order; no length prefix for the whole data section (parser knows end by stream length or by single root value).

**Type tags** (1 byte):

| Tag (hex) | Type    | Encoding |
|-----------|---------|----------|
| 0x01      | Null    | - |
| 0x02      | False   | - |
| 0x03      | True    | - |
| 0x04      | Integer | 8 bytes signed big-endian (two's complement) |
| 0x05      | Float   | 8 bytes IEEE 754 big-endian double |
| 0x06      | String  | 4 bytes length (unsigned big-endian) + UTF-8 bytes |
| 0x07      | Binary  | 4 bytes length + raw bytes (reserved/future) |
| 0x10      | Array   | 4 bytes count N + N encoded values |
| 0x11      | Object  | 4 bytes pair count K + K pairs of (4 bytes key index + value) |

**Integer**: Must be in range [-2^63, 2^63-1]. Encoded as 8 bytes signed big-endian.

**Float**: IEEE 754 double, big-endian. NaN payloads canonicalized to a single NaN representation if required by spec (e.g. quiet NaN, zero payload).

**String**: Length (4 bytes unsigned big-endian) + UTF-8 byte sequence.

**Array**: Count N (4 bytes unsigned big-endian), then N values in order.

**Object**: Pair count K (4 bytes). Each pair: key index (4 bytes unsigned, index into dictionary), then value. Pairs ordered by canonical key order (same as dictionary order).

### 6.5 Canonicalization (Binary)

1. **Key order**: Object keys sorted lexicographically by UTF-8 bytes.
2. **Dictionary**: Built by traversing the value in document order, collecting unique keys, then sorting them; indices assigned by sorted order.
3. **Number canonicalization**: Integers in range that fit in 64-bit signed are encoded as integer tag; otherwise float. Float: use IEEE 754 double; NaN → single canonical NaN.
4. **No optional padding**: No trailing bytes; no alignment padding.

---

## 7. Canonicalization Rules

- **Text → Value**: Parsing produces a unique value tree.
- **Value → Binary**: Apply key ordering and number rules above; output is unique for that value.
- **Value → Text**: Implementations may vary spacing/quoting; for a “canonical text” profile, keys in object order, consistent quoting (e.g. minimal quotes), no trailing commas (or always trailing comma)—to be defined in a future amendment if needed).

---

## 8. Error Handling Rules

- **Fail-fast**: On first syntax or encoding error, processing stops.
- **Diagnostics**: Errors MUST report line and column (text) or byte offset (binary) where available.
- **Recoverable parsing**: Not required; implementations may offer best-effort recovery for tooling only.

**Text errors**: Invalid token, unexpected character, unclosed string/comment, invalid number, unexpected end of input.

**Binary errors**: Unknown magic, unsupported version, truncated dictionary or data, invalid type tag, out-of-range key index, invalid UTF-8.

---

## 9. Security Considerations

- **Depth limit**: Parsers MUST support a configurable maximum nesting depth (e.g. default 256) to prevent stack overflow.
- **Input size**: Implementations SHOULD support configurable maximum input size (bytes/chars) to mitigate DoS.
- **Recursion**: Prefer iterative or bounded recursion when parsing nested structures.
- **Malformed input**: Reject invalid input; do not interpret ambiguous or truncated data as valid.
- **Binary**: Validate key indices against dictionary size; validate string lengths and UTF-8.
- **Resource limits**: Limit size of dictionary and number of keys per object to prevent memory exhaustion.

---

## 10. Versioning Strategy

- **Magic + Version**: Binary format carries version; parsers must reject unknown versions or document behavior.
- **Forward compatibility**: New type tags or optional sections may be added; decoders must ignore unknown tags or sections if specified.
- **Backward compatibility**: New versions should not change encoding of existing type tags for the same semantic value.

---

## 11. Examples

### 11.1 Simple object (text)

```koda
name: "KODA"
version: 1
binary: true
```

### 11.2 Array of objects (text)

```koda
vehicles[
  { id: A speed: 60 }
  { id: B speed: 40 }
]
```

### 11.3 With comments (text)

```koda
// Server config
host: "0.0.0.0"
port: 8080
/* multi
   line */
debug: false
```

### 11.4 Binary encoding (conceptual)

For `{ "a": 1 "b": 2 }` (keys canonical order `a`, `b`):

- Magic: KODA
- Version: 1
- Dictionary: 2 keys → "a", "b" (lengths and UTF-8)
- Data: Object, 2 pairs → (index 0, integer 1), (index 1, integer 2)

---

*End of specification.*
