# hg-lisp

hg-lisp is Mercury's language for describing browser behavior and fragment shaders. It compiles to multiple target languages, beginning with JavaScript and WGSL. A shared Lisp-like syntax exposes a small subset of those languages, with escape forms for writing either directly.

This document describes the intended design and the implemented subset below.
The **Core forms** section records the established notation for declarations,
assignment, symbol resolution, functions, and branching. Features outside the
implemented subset remain design examples.

See the [Mercury overview](../README.md) for the project's goals and the [JavaScript API design](api.md) for its runtime boundary.

## Implemented compiler subset

`hg.Compiler` exposes tokenization, parsing, and target compilation without
executing source. Tokens preserve the original buffer, including whitespace
and semicolon line comments. Source positions are UTF-16 offsets with
exclusive ends. Syntax and diagnostics remain available for incomplete editor
buffers; target errors prevent output code. See the
[compiler API](api.md#compiler-api) for result records and source revisions.

The JavaScript target implements ordinary calls, `let`, `set`, `get`, `fn`,
`return`, statement `if`/`elif`/`else`, lexical brace blocks, numeric and string
literals, templates, and literal/computed dot selectors. Constructors and
queries use the provided data namespaces; parameter annotations call their
`assert` operations. Arithmetic operators `+`, `-`, `*`, `/`, `%` use
`hg.Math`, and comparisons `<`, `<=`, `>`, `>=`, `==`, `!=` use JavaScript's
ordered or strict comparisons. Other API functions are available through
explicit paths such as `(hg.Math.dot a b)` and `(hg.Runtime.len entries)`.

Generated JavaScript is a strict function body accepting the host API as
`hg`. Its final value-producing expression is the result, normalized to nil
when it produces native null or undefined. The compiler returns source;
execution is a separate host operation. No scene is installed automatically.

The initial JavaScript lowering makes these provisional choices: `set`
produces its assigned value; `if` is a statement using JavaScript truthiness,
and each branch has a lexical scope; bare `return` completes an enclosing
`fn` with nil. Source names can contain hyphens and question marks and lower
to generated JavaScript identifiers. Parenthesized forms are calls: a
computed selector such as `dict.(get name)` must contain a callable operation.

Templates accept nested templates and double-quoted strings in interpolations.
Each interpolation requires exactly one value expression; brace blocks are
invalid there. Doubled braces preserve literal braces, and string escapes
decode without executing source. Numeric source suffixes use `10i`, `10u`,
and `10f`; conversion strings use the separate `"10:i"` notation. Decimal,
exponent, binary, octal, and hexadecimal literals are accepted. A hexadecimal
`f` is a digit, so hexadecimal literals use `i` or `u` for explicit suffixes.

The WGSL target supports typed helper functions and arithmetic but does not
yet generate fragment entry points, host resource layouts, or `(sh ...)`
handles. `hg.GPU.shader` separately accepts raw fragment WGSL and renders
through the runtime's vertex path. Async forms, raw source embedding,
matrices, structured shader data, and full lexical capture lowering remain
pending; unsupported forms produce diagnostics.

## Execution targets

Ordinary browser behavior targets JavaScript. Shader bodies target WGSL, the shading language used by WebGPU. A shared syntax makes it possible to describe both in one program, but each body must still obey the rules of its target.

HTML and CSS are possible future compilation targets. Their forms and compilation rules have not been specified.

| Context | Target | Role |
| --- | --- | --- |
| Browser behavior | JavaScript | Work with runtime data and browser capabilities. |
| `(sh ...)` body | WGSL | Define a programmable fragment shader. |
| `(js ...)` | Raw JavaScript | Embed JavaScript source in a JavaScript context. |
| `(gl ...)` | Raw WGSL | Embed WGSL source in a shader context. |
| Arithmetic and vector swizzles | JavaScript and WGSL | Operate on scalars, vectors, and matrices with shared mathematical meanings. |
| `async`, `promise`, and `await` forms | JavaScript only | Define asynchronous functions, create and chain promises, and await their results. |

A JavaScript value needs a WGSL-compatible shape before it can be passed to GPU work. Sharing syntax does not make JavaScript-only data or browser operations available inside a shader.

Only the fragment stage is user-programmable in Mercury. The runtime owns the vertex path; custom vertex shaders and compute shaders are unsupported.

The asynchronous forms cannot compile to WGSL. A compiler must report their use in a WGSL context as a target error.

## Compilation and tooling

The compilers have a public API, available to JavaScript applications and
hg-lisp programs. The self-hosted editor needs to inspect tokens produced
from its source buffers for syntax highlighting. See the
[compiler API](api.md#compiler-api) for implemented operations and results.

The implemented pipeline exposes tokenization independently of target
compilation. The editor can inspect source tokens without creating an app,
initializing GPU resources, or installing the buffer as a running scene.
Parsing and target code generation provide further analysis and output,
using a shared lexer and parser.

Source tokens describe the exact hg-lisp buffer being edited. Current token
records preserve text and classifications with UTF-16 ranges; whitespace and
semicolon comments are retained. Optional source identity and revision connect
results to the right document. Highlighting embedded raw source and semantic
classifications remain pending.

An editor's buffer may be incomplete or invalid while it is being typed. Tokenization should still provide useful results and source-located diagnostics where possible. Lexical classifications support syntax highlighting; optional parser or type analysis can add semantic information about names, scopes, and guards.

Generated JavaScript or WGSL belongs to the selected target and has its own output ranges. Mapping that output back to hg-lisp source is a separate compiler contract. A program containing browser and shader code may produce multiple artifacts; source-unit inputs and output packaging remain open. The edited buffer's revision can also differ from the source currently installed in a running app.

### Function hoisting

Shader definitions and shader-side helper functions must be emitted at valid WGSL module scope. [WGSL's declaration rules](https://www.w3.org/TR/WGSL/#declaration-and-scope) require function declarations at module scope, so a definition nested in hg-lisp source needs to be lifted into the surrounding generated code. The compiler must adjust names, binding references, and call sites as needed while preserving the source program's scopes and declared types.

This relocation concerns emitted declarations. It must preserve when bodies execute, when values are initialized or changed, and the return boundaries of functions. A brace block is a scope, not a function definition, and must not be hoisted into a helper function. Generated declarations also need source mappings back to the original definitions and their source revisions for diagnostics and editor inspection.

Functions use the JavaScript-style lexical capture behavior described under [evaluation](#evaluation). Hoisting must preserve those source bindings; moving an emitted declaration must not initialize or expose a source binding earlier. The WGSL representation of captures, including mutable access, generated names, and helper parameters, still needs a lowering contract within the target's constraints. Host values used by a fragment shader must cross the typed data and resource-binding boundary; a fragment entry point needs a valid stage interface rather than arbitrary closure parameters. Entry-point generation and placement of embedded raw WGSL remain open.

## Forms and scopes

A parenthesized form puts its operation first:

```lisp
(+ a b)
```

Some forms are ordinary operations, such as addition. Others are special forms that define bindings, functions, branches, or compilation boundaries.

### Brace blocks

Braces group statements in an explicit lexical scope:

```lisp
{
  ...
}
```

`let` declares a mutable binding in the current scope. `set` assigns to a resolved binding or member, and `get` explicitly resolves a symbol to its value. These forms are described under [core forms](#core-forms).

A brace block is a statement construct and produces no value. It cannot appear where a value is required, including a binding initializer, a function argument, or a computed collection accessor. Its final statement does not become a block result.

Brace blocks are never immediately invoked function expressions (IIFEs), on either target. They introduce no function, promise, or return boundary. A `return` within braces completes the enclosing function, or the current promise body or handler under its existing completion rules. Compilers must preserve that control flow without wrapping the block in a function call.

The dots in schematic examples stand for omitted source. Scopes follow the JavaScript-style [evaluation rules](#evaluation). Functions retain the implicit and explicit return behavior described under [core forms](#core-forms).

### String literals

hg-lisp accepts only double-quoted string literals:

```lisp
"hello"
```

Single quotes are not string delimiters. Apostrophes can appear inside a double-quoted string, such as `"it's ready"`. The JavaScript codebase and documentation examples also prefer double quotes.

String literals use [standard JavaScript string escapes](https://tc39.es/ecma262/multipage/ecmascript-language-lexical-grammar.html#sec-literals-string-literals), including `\n`, `\r`, `\t`, `\"`, `\\`, hexadecimal escapes, and Unicode escapes:

```lisp
"first line\nsecond line"
"say \"hello\""
"C:\\projects\\hg"
"\u0041"
```

### String templates

A dollar sign immediately before the opening double quote introduces a string template. Expressions inside single braces are evaluated and interpolated into the resulting string:

```lisp
(let name "Mercury")
$"Hello {name}"
$"Next count: {(+ 10 1)}"
$"Literal braces: {{name}}"
```

These templates produce `"Hello Mercury"`, `"Next count: 11"`, and `"Literal braces: {name}"`, respectively. Within template text, `{{` becomes a literal `{` and `}}` becomes a literal `}`. A dollar sign inside an ordinary string, as in `"$hello"`, is just string content.

Templates use the same string escapes as ordinary strings. Interpolation
braces delimit a value expression; they do not introduce a brace block or
change the [scope-only rule](#brace-blocks). The current JavaScript compiler
uses native template-literal conversion, supports nested templates, and
reports malformed interpolation with source spans. See the
[implemented subset](#implemented-compiler-subset).

## Evaluation

hg-lisp follows JavaScript's lexical scope, binding lookup, closure capture, and evaluation order while retaining its own syntax and symbol spellings. Its implicit function returns and `nil` default are defined below.

### Lexical bindings

A `let` in a child scope may shadow a binding in its parent scope:

```lisp
(let count 1)
{
  (let count 2)
  (get count)
}
(get count)
```

The inner access reads `2`; the final access reads the parent's `1`. Declaring `count` in the child does not replace the parent binding. A conflicting `let` declaration in the same scope is an error, including redeclaring an existing local or conflicting with a parameter in the function's scope. Use `set` to assign an existing binding.

JavaScript's initialization rule also applies: reading or assigning a lexical binding before it has been initialized is an error. A child declaration shadows the parent name throughout that child scope, so an early access does not fall back to the parent. See the ECMAScript rules for [lexical declarations](https://tc39.es/ecma262/multipage/ecmascript-language-statements-and-declarations.html#sec-let-and-const-declarations) and [binding access](https://tc39.es/ecma262/multipage/executable-code-and-execution-contexts.html#sec-declarative-environment-records-getbindingvalue-n-s).

### Captures

Functions capture bindings from the lexical environment where they are defined, following [JavaScript function creation](https://tc39.es/ecma262/multipage/ordinary-and-exotic-objects-behaviours.html#sec-ordinaryfunctioncreate). Calls use those bindings rather than the caller's same-named locals. Captures retain access to the binding, so later assignments are visible:

```lisp
(let count 1)
(let read-count (fn () count))
(set count 2)
(read-count)
```

The final call returns `2`. A closure can retain access to its defining bindings after that scope's execution ends. Scene resets and live code updates still need their own binding-lifetime and replacement contracts. Shader-side capture lowering is described under [function hoisting](#function-hoisting).

### Symbol resolution

In a value context, resolve a symbol using JavaScript-style lexical lookup: start with the current scope and search outward to the nearest matching binding. Explicit `get` uses the same lookup. An unresolved binding is an error; resolution does not silently produce `nil` or create a binding for `set`.

Syntax positions retain their own meaning. In particular, `dict.name` selects the literal string key `"name"`, while `dict.(get name)` resolves the variable's value as the key. Missing collection entries remain a separate [collection access](#collection-member-access) contract.

### Evaluation order

Evaluate ordinary expressions and call arguments from left to right, and statements in an executing body from top to bottom, following [JavaScript argument evaluation](https://tc39.es/ecma262/multipage/ecmascript-language-expressions.html#sec-argument-lists-runtime-semantics-argumentlistevaluation). Resolve an ordinary call's callable before evaluating its arguments. Each argument is evaluated before entering the called function.

Control forms preserve their specified selection and early-exit behavior: unselected `if` branches do not execute, and `return` or `reject` ends its current body. This order describes active evaluation; it does not impose a completion order on independently started asynchronous work. Compiler lowering must preserve the observable order on each target.

### Function results

A function implicitly returns its final statement's value when that statement produces one. An empty function, or a function whose final statement produces no value, returns `nil` unless an explicit return has already completed it.

Calling either function below returns `nil`:

```lisp
(fn ())
(fn ()
  {
    10
  })
```

The brace block remains a statement scope with no value; its inner `10` does not become a function result. An explicit `return` inside braces still completes the enclosing function.

Promise bodies and handlers use the same normal-result rule, including `nil` for empty or non-value bodies. The proposed `finally` contract separately preserves the preceding outcome after successful cleanup. Since `nil` is JavaScript-only, WGSL compilation needs a valid lowering for functions without a value result, such as a function without a WGSL return type when the result is unused. The target support and diagnostics for cases requiring a `nil` value remain compiler contracts.

## Data model

hg-lisp's data model is designed for web compatibility through JSON. Scalars use the direct representations described below. All scalar numeric types are ordinary JavaScript numbers on the JavaScript side. An ordinary JavaScript object becomes a `dict`; an object representing another Mercury type must contain a `__type__` field. Other serializable object types use that same discriminator in JSON, intended to closely match their internal JavaScript representation. Discriminator values and payload shapes remain to be specified.

The JavaScript API keeps data separate from functions. Operations are grouped in plain namespace objects and take the data they operate on explicitly. Classes are not part of that API model, and any Mercury-defined getter or setter requires documentation of its purpose and behavior. See the [API conventions](api.md#api-conventions).

This model applies to hg-lisp data values. Callable functions and shader handles also participate in a program, but their JavaScript representation is a separate API decision. WGSL receives typed values and resource bindings rather than JavaScript objects.

Each data type has three corresponding operations:

| Operation | Purpose |
| --- | --- |
| Type query | Return a boolean indicating whether a value satisfies a type. |
| Type guard | Require a particular type at an annotated boundary. |
| Type constructor | Construct a value; primitive constructors convert supplied values. |

### JavaScript-only types

| Type | Description |
| --- | --- |
| `nil` | Absence of a value, merging JavaScript's `null` and `undefined`. |
| `num` | A JavaScript number. |
| `str` | A JavaScript string. |
| `list` | A JavaScript list of runtime data. |
| `dict` | A JavaScript string-keyed map of runtime data. |

These names describe Mercury values backed by JavaScript data. `num` is an ordinary JavaScript number, and ordinary JavaScript objects map to `dict` unless they carry the reserved `__type__` field. Their JSON mappings are defined below.

### Booleans

The boolean type is `bool`. It exists in both JavaScript and WGSL, but Mercury does not allow boolean values to cross the JavaScript/WGSL boundary. Booleans can be created and used within either execution environment; shader-local operations, including helper function parameters and results, can use `bool`.

WGSL's restriction is that `bool` is not [host-shareable](https://www.w3.org/TR/WGSL/#host-shareable-types). It cannot be packed directly into host-shared uniform or storage buffers. Boolean fields and elements likewise exclude a composite value from host-shared buffer data. This restriction concerns data sharing, rather than limiting booleans to a single lexical scope.

JSON booleans map directly to `bool`. JSON serialization on the JavaScript side does not make those values transferable to a shader.

### Numeric literals

An unsuffixed numeric literal has type `num`. A suffix selects a WGSL-compatible scalar type:

| Literal | hg-lisp type | JavaScript representation |
| --- | --- | --- |
| `10` | `num` | Number `10`. |
| `10i` | `i32` | Number `10`. |
| `10u` | `u32` | Number `10`. |
| `10f` | `f32` | Number `10`. |
| `10.5f` | `f32` | Number `10.5`. |

The suffix describes the numeric type in hg-lisp source; it does not create a wrapper or a separate numeric representation in JavaScript. `num`, `i32`, `u32`, and `f32` all use JavaScript numbers there. Conversion to and from the target numeric representation occurs at JavaScript/WGSL boundaries.

`true` and `false` are symbols in hg-lisp, rather than a separate boolean literal syntax. Their binding and resolution rules are part of symbol evaluation. This is distinct from JSON booleans, which decode directly as `bool` values.

### Collection member access

Lists and dictionaries use dot notation to access their members. These expressions select the collection's logical entries, independently of its internal JavaScript representation.

```lisp
list.0
dict."key"
dict.key
```

List indices start at 0: `list.0` accesses the first element, and `list.1` accesses the second. Dictionary keys can be plain symbols or double-quoted string literals. `dict.key` and `dict."key"` both access the literal string key `"key"`; the symbol suffix does not evaluate a binding named `key`.

A parenthesized expression after the dot provides a computed index or key:

```lisp
list.(+ i 1)
dict.(get name)
```

`list.(+ i 1)` evaluates `(+ i 1)` and uses its result as the list index. In `dict.(get name)`, `name` is a variable holding a string key: `get` resolves its value, which selects the dictionary entry. In contrast, `dict.name` selects the literal key `"name"`.

Computed selectors must be value-producing expressions. [Brace blocks](#brace-blocks) cannot be used as collection accessors.

Here, `list` and `dict` stand for collection values. Lists and dictionaries are JavaScript-only data types. Access rules for WGSL-compatible arrays, structs, and vector swizzles are separate contracts.

`set` accepts this dot notation for assignment, including computed selectors.
The [reserved type metadata rule](#reserved-type-metadata) prohibits writes
to `__type__`. The initial JavaScript index, missing-key, and insertion rules
are implemented by [hg.Runtime](api.md#collection-member-access); broader
shader collection access remains open.

### Nil

`nil` is hg-lisp's single absence type. It combines the concepts represented by `null` and `undefined` in JavaScript. The `(nil)` form constructs a nil value:

```lisp
(nil)
```

When JavaScript values enter the hg-lisp value model, both `null` and `undefined` become `nil`. Its JSON representation is always the literal `null`.

Serializing a nil value produces JSON `null`, and deserializing JSON `null` produces a nil value. This also applies to nil values nested in serializable lists, dictionaries, and other containers.

### WGSL-compatible numeric types

| Type | Description |
| --- | --- |
| `i32` | A 32-bit signed integer. |
| `u32` | A 32-bit unsigned integer. |
| `f32` | A 32-bit floating-point number. |
| `vec2i` | A two-component vector of `i32` values. |
| `vec3i` | A three-component vector of `i32` values. |
| `vec4i` | A four-component vector of `i32` values. |
| `vec2u` | A two-component vector of `u32` values. |
| `vec3u` | A three-component vector of `u32` values. |
| `vec4u` | A four-component vector of `u32` values. |
| `vec2f` | A two-component vector of `f32` values. |
| `vec3f` | A three-component vector of `f32` values. |
| `vec4f` | A four-component vector of `f32` values. |
| `mat2x2f` | A 2-by-2 matrix of `f32` values. |
| `mat3x3f` | A 3-by-3 matrix of `f32` values. |
| `mat4x4f` | A 4-by-4 matrix of `f32` values. |

The shorter vector and matrix names are aliases:

| Alias | Type |
| --- | --- |
| `vec2` | `vec2f` |
| `vec3` | `vec3f` |
| `vec4` | `vec4f` |
| `mat2` | `mat2x2f` |
| `mat3` | `mat3x3f` |
| `mat4` | `mat4x4f` |

### Structured data and resources

| Type | Description |
| --- | --- |
| `struct` | Structured data with declared fields and types. |
| `array` | A WGSL-compatible collection with a declared element shape. |
| `texture2d` | A resource representing a two-dimensional texture. |
| `texture3d` | A resource representing a three-dimensional texture. |

A `list` is a JavaScript collection. An `array` needs an element shape that can be represented in WGSL. Element types, length declarations, and construction syntax still need to be defined.

Textures are GPU resources. Their formats, sampling rules, access modes, and bindings require additional API information beyond their dimensions.

### Type queries

Type queries are ordinary boolean functions named `<type>?`. Each takes a value and answers whether that value satisfies the named type:

```lisp
(i32? 10)
(i32? 10.5)
(i32? "10")
```

These calls produce `true`, `false`, and `false`, respectively. A mismatch returns a boolean result rather than raising a guard error. Queries do not convert their arguments.

On the JavaScript side, numeric queries inspect value shape. The unsuffixed `10` is a `num` in source and still passes `i32?`; no stored `i32` tag or suffix provenance is required. The exact range checks, composite validation, and alias behavior remain part of each type's contract.

### Type guards

Function parameters, shader parameters, and struct fields can be annotated with `name:type` guards.

```lisp
(fn (a:i32 b:i32)
  (+ a b))
```

Here, `a` and `b` must satisfy the `i32` guard before the function body runs. In JavaScript, guards assert the shape of the supplied values: an `i32` parameter requires an integer, so a fractional number does not pass by being silently truncated. In WGSL, guards become static type declarations. Guards validate values; primitive constructors perform explicit conversion. Numeric ranges, non-finite values, and the full validation rules still need contracts.

Guard failures are hard errors. A failing value does not pass the guarded boundary, and a function with a failing parameter guard does not enter its body. Error representation and reporting remain to be specified.

Runtime guards check values as they pass through a guarded boundary. They do not continuously watch a value or automatically recheck it after every mutation. A value that changes out of shape after a successful check is caught at its next guard, if it encounters one. Queries remain available for an explicit boolean check without assertion.

Struct declarations use the same notation:

```lisp
(struct SpriteData
  transform:mat3
  tint:vec4)
```

This describes the shape of sprite data. Creating instances and referring to named struct types still need constructor syntax.

### Primitive constructors

Primitive type constructors convert supplied values from one type to another. They are permissive about convertible inputs, and an input that cannot be converted raises an error. They do not require the input to already pass the destination type's guard.

A compiler can lower a constructor directly into a declaration when the conversion's result is known and no runtime conversion is needed:

```lisp
(let x (i32 10))
```

On the JavaScript side, this can become:

```javascript
let x = 10;
```

Inside a WGSL function, the same mutable declaration can become:

```wgsl
var x: i32 = 10;
```

The JavaScript value remains an ordinary number. Explicit constructors can convert other primitive input types; numeric representation changes between JavaScript and WGSL happen at their boundary. The compiler may remove a constructor call only when it preserves conversion, error behavior, and the language's mutable binding semantics.

The current JavaScript data bindings make scalar constructors variadic:
numeric, string, and boolean constructors accept zero arguments or a single
`undefined` for their defaults, one other argument to convert, and reject
additional arguments. `nil` accepts at most one argument and produces `null`.
Constructors use the provided data type conversions; numeric strings use
JavaScript `Number`, and numeric results must be finite. `i32` and `u32`
truncate toward zero and clamp to their ranges. `f32` clamps finite host
numbers to its range without applying `Math.fround`.

Numeric conversion strings use a trailing `:i`, `:u`, or `:f` to select the corresponding scalar constructor. The parser trims surrounding whitespace and uses JavaScript `Number` on the remaining body, supporting decimal and exponent notation as well as hexadecimal, octal, and binary forms. For example, `(num "1.5:f")`, `(num "1e3:i")`, `(num "0xff:u")`, `(num "0o77:i")`, and `(num "0b10:f")` apply the selected conversion and return ordinary JavaScript numbers. Empty bodies and `NaN` parse results are syntax errors; parsed infinities fail numeric construction. These conversion strings are distinct from the intended [source numeric literal syntax](#numeric-literals).

Collection constructors build lists from their argument entries and dictionaries from alternating keys and values. For example, `(list 10)` produces a list containing `10`, and `(dict "x" 10)` produces a dictionary whose `"x"` entry is `10`. The current vector bindings also accept multiple arguments. Their exact JavaScript inputs and conversion rules are documented under [implemented data bindings](api.md#implemented-javascript-data-bindings); compiler lowering and shader-boundary conversion remain separate design contracts.

### Passing data to shaders

A type declaration establishes the shape of a value. Passing that value to the GPU also requires a buffer layout or resource binding.

Availability within WGSL does not imply that a type can cross the host boundary. In particular, `bool` is usable inside a shader but cannot be passed between JavaScript and WGSL, including as a field or element in shared data.

WGSL buffer data has alignment and padding requirements. Textures use resource bindings rather than fields packed into a buffer. A Mercury object that groups numeric data and a texture therefore needs a rule for separating buffer data from resource bindings. See the WGSL definitions of [host-shareable types](https://www.w3.org/TR/WGSL/#host-shareable-types) and [memory layout](https://www.w3.org/TR/WGSL/#memory-layout).

The raw WGSL API currently accepts a four-component `Float32Array` uniform.
General typed packing and resource bindings remain open. A plain JavaScript
object should not be treated as a GPU byte layout.

### JSON serialization

The current `hg.Json.encode`/`decode` API supports finite scalar values,
nil, lists, dictionaries, and validated vector records. Cyclic JSON and
nonserializable contents reject; repeated references lose identity. The wider
composite encoding below remains design work. See
[the implemented JSON boundary](api.md#json-serialization).

Most hg-lisp data types should serialize to and from JSON for web compatibility. The following mappings are one-to-one in both directions and need no type wrapper in JSON:

| JSON value | hg-lisp type |
| --- | --- |
| Number | `num` |
| String | `str` |
| Boolean | `bool` |
| `null` | `nil` |
| Array | `list` |

For example, this JSON value describes a `list` containing a `num`, a `str`, a `bool`, and a `nil`:

```json
[42, "hello", true, null]
```

All scalar numeric types serialize as ordinary JSON numbers. For example, `10i` serializes as `10` and decodes as `num`. The round trip loses the `i32`, `u32`, or `f32` distinction; scalar numbers do not carry a JSON type discriminator.

Other serializable object types use JSON objects containing `__type__`. Vectors, matrices, structs, and WGSL-compatible arrays retain their types through those encodings. A plain JSON array maps to `list`, while a typed `array` retains its element shape through its object encoding. These objects should closely match the types' internal plain-object representation; discriminator values and payload fields still need to be defined.

Container contents use the same rules recursively. A container is serializable only when its contents and structure are supported by the serialization contract. Application and shader handles are nonserializable even when held inside an otherwise serializable collection.

A live memory inspector can expose handles that a saved document cannot contain. Saving selected scene or app data therefore does not imply serializing the whole running environment. Data used to recreate an application or shader needs its own representation; it does not serialize the existing handle.

#### Dictionaries and the `__type__` field

Ordinary JavaScript objects and JSON objects map directly to `dict` unless they contain the reserved `__type__` field. This keeps ordinary web payloads usable without adding wrappers to every dictionary. An object must contain `__type__` to be interpreted as another Mercury type; its tag value and payload still need validation.

The implemented JSON API rejects unknown type tags and malformed vector
payloads. The policy for future composite types remains open. Presence of
`__type__` establishes the type-marker boundary without establishing that
every tagged object is valid.

The field is reserved for type metadata. The recommended [mutation rule](#reserved-type-metadata) rejects ordinary assignments to it while allowing constructors and decoders to establish validated metadata when creating a value.

A dictionary that needs a literal `__type__` entry requires a collision policy. An explicit tagged `dict` encoding that preserves its entries as data remains a proposed escape mechanism; its payload format and the import policy for colliding external objects still need to be defined. Any such escape must distinguish the literal data entry from the actual type metadata before defining its access and mutation rules.

Remaining serialization rules include new payload fields, named struct
definitions, dictionary collision escapes, and additional resource types.
The initial API already rejects non-finite numbers, cycles, and
nonserializable container contents.

## Arithmetic and linear algebra

Arithmetic operations, including vector and matrix operations, work in both JavaScript and WGSL. WGSL-compatible numeric types are usable on the JavaScript side as well as in shaders. For each supported operand combination, the operation should have the same mathematical meaning and result type and shape on both targets.

The proposed shared semantics follow [WGSL arithmetic](https://www.w3.org/TR/WGSL/#arithmetic-expressions):

| Operation family | Proposed meaning |
| --- | --- |
| Scalar arithmetic | Apply the numeric operation to scalar operands. |
| Vector arithmetic | Apply supported operations component by component. Vector multiplication is a component-wise product. |
| Matrix addition and subtraction | Add or subtract corresponding components of matrices with matching shapes. |
| Scalar scaling | Scale the components of a vector or matrix by a scalar. |
| Matrix-vector multiplication | Compute the linear algebra product, producing a vector. |
| Matrix-matrix multiplication | Compute the linear algebra product, producing a matrix. |

The accepted operand types and dimensions determine whether an operation is valid. The precise operator and function vocabulary, mixed-type operation rules, and numeric edge cases still need to be specified. Component-wise multiplication and linear algebra multiplication must remain distinct wherever both are supported.

JavaScript compilation provides scalar/vector operations through explicit
`hg.Math` calls. Their availability does not depend on JavaScript's native
operators accepting those object representations. Matrix operations remain
pending. See [host math operations](api.md#shared-math-operations).

Cross-target support requires consistent operation semantics, without promising bitwise-identical floating-point results. Integer overflow, division behavior, floating-point precision and rounding, and result allocation or mutation policies need explicit contracts.

### Vector swizzles

Vector swizzles also work on both targets. A read swizzle selects components, can change their order, and can repeat them. One selected component produces a scalar; multiple selected components produce a vector with the original component type.

For a four-component vector with values `x = 1`, `y = 2`, `z = 3`, and `w = 4`, WGSL-style read masks illustrate the operation:

| Mask | Selected components | Result shape |
| --- | --- | --- |
| `x` | `1` | Scalar. |
| `xy` | `1, 2` | Two-component vector. |
| `yx` | `2, 1` | Two-component vector. |
| `xx` | `1, 1` | Two-component vector. |
| `wzyx` | `4, 3, 2, 1` | Four-component vector. |

These masks illustrate component selection rather than defining hg-lisp's access syntax. The exact syntax and mask vocabulary, including any color-component aliases, still need to be chosen. Both targets must enforce the supported component ranges and mask rules consistently.

Swizzle implementation should follow the explicit-operation API convention; it does not require getters or setters on JavaScript vector objects. Writable swizzles, repeated components in write masks, copy-versus-view behavior, and dynamically chosen masks remain open. WGSL writes must respect the selected target's capabilities, including any supported [swizzle assignment extension](https://www.w3.org/TR/WGSL/#swizzle-view-expression).

## Mutability

hg-lisp is maximally mutable. `let` creates mutable bindings, and `set` changes their values or supported members. The language provides no constant declaration form, constant modifier, or immutable-binding mode.

### Reserved type metadata

The recommended policy reserves `__type__` for the runtime value representation. Ordinary member mutation must not add, replace, or remove that field on an existing object. Constructors and decoders can establish it as part of creating a validated value. Bindings and ordinary payload fields remain mutable. Guard validation occurs at guarded boundaries; reserved-field validation is a separate mutation rule.

The compiler should report an error when a write's target is statically known to be `__type__`. These assignments would therefore be rejected:

```lisp
(set item.__type__ new-type)
(set item."__type__" new-type)
```

The same diagnostic applies to a computed selector when the compiler can prove that it selects the reserved field. For a selector whose key is known only at runtime, such as `(set item.(get key) value)`, the recommended mutation check rejects the write if the resolved key is `"__type__"`. A compiler cannot generally report a compile-time error for an unknown key.

Live inspector writes should follow the same rule. Direct host JavaScript or embedded raw JavaScript can mutate a plain object outside hg-lisp's checked operations; compiler diagnostics alone do not protect those writes. Runtime enforcement at the JavaScript boundary and exact error behavior still need contracts, without requiring getters or setters on the data.

A runtime value may mutate out of the shape accepted by an earlier guard without an immediate guard error. A later guarded boundary checks its current shape and raises a hard error if it no longer satisfies the guard. With no later guard, there is no background guard check. Other mutation rules remain separate, and shader-side changes must still satisfy WGSL's static typing, storage, and access rules.

The runtime still needs an explicit policy for when host-side changes become visible to GPU work. Guard timing does not establish automatic synchronization.

## Scene execution and memory

A scene runs within a Mercury application instance. The application provides two scene operations: a live update that preserves scene memory, and serving a fresh scene that resets it. The [scene API design](api.md#serving-scenes-and-live-updates) describes the operations and their proposed contracts.

Preserving scene memory requires stable rules for declarations across code changes. The language still needs to decide how an existing binding is identified, whether its initializer runs again, and what happens when a new type guard disagrees with the retained value. Replacing code also needs rules for updating functions and callbacks that refer to preserved bindings.

Information intended for a later scene needs a lifetime outside the current
scene's scope. The implemented [app-owned store](api.md#data-that-survives-scenes)
copies snapshots for that data. hg-lisp can call it through `hg.Store` when
an app reference is supplied; this does not make every local binding survive
serving a fresh scene.

## Self-hosted editing

Mercury's ultimate goal is an editor written in hg-lisp. The editor displays its own source, and changes to that source modify the running editor in real time. It also manages a separate application instance for the project being developed.

To support that workflow, hg-lisp programs need access to the runtime's [reflection and external control API](api.md#reflection-and-external-control). The editor must be able to enumerate live bindings, inspect their types and values, change values, and apply live code updates or serve fresh scenes on a target instance. Invoking functions or API operations on another app's behalf is also being considered.

Inspectable bindings need runtime identities and source metadata. A preserved binding should remain accessible when its code is updated, while a reset should invalidate references to the old scene. A possible implementation represents bindings as explicit runtime records accessed by compiled code; the design does not yet choose the compiler strategy or which temporary locals are inspectable.

Editing source changes program behavior through the scene-update mechanism. Editing a live value changes the current state through runtime mutation rules. A live edit does not trigger a type guard merely because the target was guarded earlier; a guard applies when the value next crosses a guarded boundary. Whether a particular inspector operation provides such a boundary is an API contract. A value edit does not automatically rewrite its source initializer.

An hg-lisp program needs a way to obtain its own app reference and hold references to child instances. The same operations should work against either target. Targeted function or API calls, if provided, must use the target app's environment and memory. Language-facing syntax, source access, injected command scope, and update scheduling remain open.

The editor also uses the public compiler API to inspect its source buffers for highlighting and diagnostics. Analyzing edited source and applying it to a running app are separate explicit operations.

## Core forms

The forms below define scoped declarations, assignment, explicit symbol resolution, functions, returns, and branching. Their general evaluation rules are established above; composite constructor arguments and some individual form results still need to be settled before these examples can serve as a runnable reference.

### `(let name value)`

Declare and initialize a mutable binding in the current scope:

```lisp
(let count 0u)
```

This binds `count` to a `u32` literal, represented as an ordinary number in JavaScript. Every `let` binding is mutable; there is no form or modifier for making it constant. Child scopes may shadow this binding, while conflicting declarations in its own scope are errors. The compiler must preserve the [lexical binding rules](#lexical-bindings) when choosing target-language declarations.

### `(set target value)`

Assign a new value to a target:

```lisp
(set count (+ count 1u))
```

This updates the binding introduced above. `set` also accepts dot notation when resolving its target, including the list and dictionary locations described under [collection member access](#collection-member-access):

```lisp
(set list.0 value)
(set dict."key" value)
(set dict.key value)
(set list.(+ i 1) value)
(set dict.(get name) value)
```

These examples assume existing collection and value bindings. Literal dictionary suffixes identify string keys, while computed selectors supply the index or key to update. Insertion, invalid targets, type checks, and mutation rules for additional data types remain to be specified.

Assignments to the reserved `__type__` field should be compiler errors when the target is statically known. Computed writes need the corresponding runtime validation when their keys are not known during compilation. See [reserved type metadata](#reserved-type-metadata).

### `(get symbol)`

Explicitly resolve a symbol to its current value:

```lisp
(let name "player")
(get name)
dict.(get name)
```

Here, `(get name)` produces the string `"player"`, and `dict.(get name)` accesses that key. `dict.name` would access the literal key `"name"` instead.

Explicit `get` is not required in every context. Arithmetic expressions such as `(+ a b)` resolve their operands implicitly using lexical lookup; unresolved bindings are errors. Use `get` where explicit symbol resolution is needed, including a variable used as a computed dictionary key. See [symbol resolution](#symbol-resolution) and [evaluation order](#evaluation-order).

### `(fn (parameters ...) body ...)`

Define an ordinary function:

```lisp
(fn (a:i32 b:i32)
  (+ a b))
```

Parameter guards establish the input types. The function implicitly returns its final statement's value, so this example returns the result of `(+ a b)`. In a body with multiple statements, the last statement supplies the result when it produces a value, unless an explicit `return` completes the function early.

A final brace block supplies no value, so the function returns `nil` unless an explicit return completes it earlier. An empty body also returns `nil`. Functions use lexical [captures](#captures), and shader-side helper definitions follow the compiler's [function hoisting](#function-hoisting) requirement. Return-type declarations, WGSL capture lowering, and supported shader-side function operations remain open.

### `(return ...)`

Explicitly complete the enclosing function before its final statement. A supplied value is the result of that completion, including when `return` appears inside a brace scope:

```lisp
(fn ()
  {
    (return "done")
  }
  "unused")
```

This function returns `"done"` without evaluating `"unused"`. The brace block adds a lexical scope and does not intercept the return. The value produced by bare `(return)` remains to be specified.

In promise bodies and handlers, ordinary successful completion also supplies the promise stage's result. The promise-specific overload is described under [asynchronous forms](#asynchronous-forms).

### `(if cond then elif cond then ... else then)`

An `if` form supports an initial branch, additional `elif` branches, and a final `else` branch within the same parentheses:

```lisp
(if first-condition
  (set count first-count)
  elif second-condition
  (set count second-count)
  elif third-condition
  (set count third-count)
  else
  (set count fallback-count))
```

In the schematic signature, `cond` stands for a condition and `then` stands for its branch body. `then` is a placeholder, not a literal keyword. `elif` and `else` are the branch markers used inside the form.

Check conditions in order and evaluate the first matching branch body. If none matches, evaluate the `else` body. Unselected branch bodies do not execute. Repeat `elif cond then` for each additional conditional branch.

Condition typing, whether `else` may be omitted, and whether an `if` produces a value still need to be specified for both targets.

## Asynchronous forms

`async`, `promise`, and `await` are JavaScript-only forms. They cannot be compiled in shader bodies or other WGSL contexts.

### `(async function)`

Wrap a function to make it asynchronous:

```lisp
(async (fn ()
  ...))
```

The wrapper applies to the function, rather than executing its body immediately. Calling the resulting function produces a promise. Its final statement implicitly supplies the successful result unless an explicit completion or failure occurs first. An empty or non-value body supplies `nil` as the successful result.

### `(promise body ... then ... catch ... finally ...)`

Create a promise whose body can complete through an implicit final-statement result or an explicit `return` or `reject`. Resolution and rejection functions are not injected into the language environment. The form also supports a sequence of `then`, `catch`, and `finally` clauses.

The body-first layout below is a working syntax proposal for the revised form:

```lisp
(promise
  initial-value
  then ()
    first-result
  then ()
    (return second-result)
  catch (e)
    (reject e)
  finally ...
  then ()
    final-result
  catch (e)
    fallback-value
  finally ...)
```

`then`, `catch`, and `finally` are chain markers within the form. An empty parameter list is shown for the `then` callbacks; `catch (e)` binds the rejection reason. `finally` introduces cleanup code without a parameter list. The dots stand for omitted cleanup bodies.

Promise bodies and continuation handlers follow the implicit function-return rule: their last statement supplies their normal result, or `nil` when the body is empty or ends with a non-value statement. Explicit `return` completes a body early, and `reject` completes it with failure.

Clauses occur in chain order. Further `then` or `catch` clauses can follow a `finally` clause; `finally` does not have to end the chain. Exact constructor layout, parameter-list separators, and applying this chain syntax to existing promises remain to be specified.

### `(return value)` and `(reject reason)` in promises

Both forms complete the current promise body or continuation handler and end that body's execution:

| Form | Completion |
| --- | --- |
| `(return value)` | Supply successful completion, resolving the current promise or chain stage. |
| `(reject reason)` | Return a rejected promise for the current body or chain stage, without throwing. |

An explicit failure is therefore:

```lisp
(promise
  (reject "Unable to load the scene"))
```

Unlike an injected settlement callback, `reject` is a returning form: later expressions in that body are not evaluated. It rejects the current stage, rather than trying to settle an earlier promise again. Later handlers follow the resulting fulfillment or rejection as the chain continues.

The successful-completion overload applies to the promise body and `then` handlers. A `catch` can recover by completing with `return`, or preserve failure with `reject`, under the recommended chain semantics below. `finally` needs its own completion rule because cleanup normally preserves the preceding outcome.

Argument defaults, promise adoption, and rejection boundaries for nested functions still need to be specified. Brace scopes do not introduce a separate completion boundary. The promise-specific behavior is JavaScript-only; ordinary `return` remains a general language form. These promise semantics do not establish a WGSL `reject` form.

### `(await value)`

Await a promise's outcome within supported asynchronous code:

```lisp
(async (fn ()
  (await task)))
```

The recommended behavior follows JavaScript: awaiting pending work suspends the current async function; fulfillment supplies the awaited value, and an uncaught rejection ends that function with a rejected result. It should not silently become `nil`. Permitted await contexts, including any top-level support, remain open.

### Promise behavior and error propagation (proposal)

The recommended chain semantics follow JavaScript promises:

| Clause | Recommended behavior |
| --- | --- |
| `then` | Handle fulfillment; an unhandled rejection passes through. |
| `catch` | Handle rejection; normal implicit or explicit return recovers, and `reject` propagates failure. |
| `finally` | Run cleanup after settlement; a normal cleanup return preserves the previous outcome, while rejected cleanup replaces it with failure. |

The proposed `finally` rule preserves the incoming outcome instead of replacing it with a normally returned cleanup value, whether that return is implicit or explicit. The corresponding JavaScript behavior is defined by [Promise operations](https://tc39.es/ecma262/2025/multipage/control-abstraction-objects.html#sec-promise-objects) and [Await](https://tc39.es/ecma262/2025/multipage/control-abstraction-objects.html#await).

The proposed error policy omits a `throw` form. Explicit asynchronous failures use `reject`, and existing failures propagate through promises and `await`. Native JavaScript failures can still occur, so their conversion to hg-lisp rejection reasons and the handling of synchronous runtime errors need explicit rules.

Compiler lowering must make body completion determine the promise outcome. JavaScript Promise constructors ignore normally returned executor values; see the [Promise constructor](https://tc39.es/ecma262/2025/multipage/control-abstraction-objects.html#sec-promise-executor). One possible lowering invokes a zero-argument async function and attaches the chain handlers to its result. Callback-style JavaScript interoperability may use adapters; those contracts remain open and do not require exposing settlement callbacks in hg-lisp.

Promise values represent live work. Their runtime representation, inspection, serialization policy, and lifetime across scene updates or resets still need to be defined independently from the serialization of their eventual data values.

## Shader functions: `(sh ...)`

This form remains a design contract. The current WGSL compiler emits typed
helpers, and `hg.GPU.shader` independently accepts raw WGSL fragment source;
neither produces a callable hg-lisp shader handle yet.

`sh` defines a fragment shader function. Its body is compiled to WGSL, and the surrounding JavaScript receives a shader handle that can be called like a function at runtime. It does not define a generic shader stage: custom vertex and compute shaders are unsupported.

The design gives fragment rendering a callable interface in the host program. The shader body executes in the GPU context; the handle belongs to the JavaScript runtime. The runtime supplies the vertex path.

Shader parameters can use type guards to describe their inputs. A complete shader call contract must also define the fragment input interface, resource bindings, rendering destination, output dimensions, and completion behavior. Calling a handle does not yet imply a synchronous JavaScript return value.

Shader and helper definitions follow the [function hoisting](#function-hoisting) requirement. The parameter and body syntax for `sh`, its relationship to fragment entry points, and its invocation signature remain open.

## Raw source: `(js ...)` and `(gl ...)`

These escape forms are not yet implemented. Both current compiler targets
report them as unsupported rather than evaluating or guessing their syntax.

`js` embeds raw JavaScript source, which is emitted during compilation in a JavaScript context. `gl` embeds raw WGSL source in a shader context.

These forms let a program use capabilities that are easier to express in the target language or are outside hg-lisp's small core. The embedded source is governed by that target language.

Raw source delimiters, escaping, access to surrounding bindings, and expression results still need to be specified. The dots in `(js ...)` and `(gl ...)` denote source that has deliberately been left out of this design sketch.

## Remaining design decisions

The next revision needs to settle these contracts:

- **Value details:** numeric literal edge cases, template interpolation details, exact primitive conversion rules, and composite value shapes.
- **Type details:** numeric range checks, composite validation, aliases, which operations are guarded, and hard error representation and reporting.
- **Math:** operator and function names, operand combinations, numeric behavior, swizzle syntax, result ownership, and writable swizzles.
- **Evaluation details:** broader form results and shader-side capture lowering; initial JavaScript `set`, statement `if`, and bare `return` behavior are defined above.
- **Collection access:** WGSL arrays/structs and wider external writes; host index, missing-entry, insertion, and metadata rules are implemented through `hg.Runtime`.
- **Async execution:** constructor layout, completion scope in nested functions, argument defaults, promise adoption, `finally` behavior, await contexts, native interoperability, and pending-work lifetimes.
- **Compilers:** source units, mixed target output, semantic analysis, full WGSL capture lowering, and source mappings; initial operation and result schemas are implemented.
- **Reflection:** app references, inspectable bindings, source identities, live writes, and external call scope.
- **Structured data:** named types, array element types and lengths, matrix construction, and GPU packing.
- **Serialization:** additional composite discriminators and dictionary collision escapes beyond implemented snapshot JSON; live contents and cyclic JSON already reject.
- **Shaders:** declaration syntax, fragment entry-point interfaces, invocation, bindings, rendering destination, output dimensions, and completion.
- **Interop:** raw source delimiters and access to hg-lisp values from embedded code.
