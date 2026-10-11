# Reference implementation review

Reviewed October 10, 2026. The project owner supplied `api.md`, `hg-lisp.md`,
and TypeScript examples from another engine implementation. They are references:
preserve this engine's behavior until a difference is discussed. The subsequently
agreed changes are numeric constructor clamping, native list/dict storage,
native JSON, finite numeric values, named vector fields, scalar constructor
defaults, nil construction, numeric string/literal parsing and suffixes, and
dictionary/vector construction, recorded below. Immediate `f32` rounding and
false truthiness for empty lists, dictionaries, and many are explicitly retained.
Boolean `true` and `false` also remain reserved literals, as agreed below.
Strings and templates adopt modern JS escapes and the `$"` template prefix.
Access adopts computed dot selectors and explicit binding/path lookup with `get`.
Functions and promise handlers adopt implicit final-value returns with explicit early returns.
Async function wrapping uses `async`; construction/chaining uses `promise` with explicit
`resolve` and `reject` stage exits. Normal stage completion remains supported. Catch receives custom tagged error records,
not native JS errors or untyped dictionaries. The Lisp `throw` binding is omitted;
`resolve` and `reject` require a lexically enclosing stage and invoke its callbacks.
Boolean host/GPU transfer adopts the reference restriction, including nested fields
and collection elements; shader-local booleans remain supported.
The `type` form reports Lisp types as dunder strings; scalar numbers share `"__num__"`.
Shader helpers adopt live lexical captures, passing read-only captures by copy and
captures written by the helper or its callees by hidden WGSL pointers.
Raw `js` and `gl` forms are deferred; no syntax or interop contract is approved.
Scene execution adopts separate fresh `App.serve` and preserving `App.patch`
operations, matching top-level data bindings by name and replacing code definitions.
Bindings whose retained values fail a new explicit type guard are reinitialized
using their new source initializer.
Resource cleanup remains with the resource's owner; binding removal or
reinitialization does not trigger automatic disposal.
Shared data across fresh scenes uses the existing plain per-app `app.state`
dictionary, with live values and explicit saving instead of a separate `Store` API.
Initial reflection is limited to top-level scene bindings and selects live binding
references with explicit inspect/read/write operations. References follow same-name
bindings across committed patches, including reinitialization, and are permanently
invalidated by removal, fresh serving, or disposal. Representation and write
validation now use registered `__binding__` records and ordinary `set` rules,
implemented through `App.inspect`, `App.read`, and `App.write`. Locals and active
call frames are deferred.
Function invocation supports both ordinary calls and `App.call` through a live
binding reference, with immediate execution and normal parameter/result behavior.
`App.exec` executes injections in the app's live top-level environment, creating
persistent bindings without editing its stored source.
Pause/start stop and resume automatic scheduling without paused-time catch-up;
explicit pause survives scene replacement and repeated starts do not add loops.
Presentation borders follow the outer canvas or its parent; runtime-created
canvases default to a black CSS background and supplied canvases may be transparent.
Image smoothing uses the explicit boolean `is` option, independent of `si`,
and defaults to false.
Supplied canvas bitmap sizing belongs to the host; runtime-created canvases
follow CSS viewport bounds multiplied by device pixel ratio.
Runtime-created textures expose their own `__texture2d__` type marker and predicate,
with registered identity and existing resource ownership retained.
This review does not approve
other additional bindings or lifecycle operations.

## Reading the documents

| Source | Use in this repository |
| --- | --- |
| [STYLE.md](./STYLE.md) | Implementation conventions and numeric conversion preference. |
| [ARCHITECTURE.md](./ARCHITECTURE.md), [APP.md](./APP.md), [ACCESSORS.md](./ACCESSORS.md) | Current implementation and ownership contracts. |
| [OBJECTIVES.md](./OBJECTIVES.md) | Requirements and explicitly deferred work from this project's discussion. |
| [API-DESIGN.md](./API-DESIGN.md) | Proposed shared JS/Lisp surface; unapproved signatures remain proposals. |
| [api.md](./api.md), [hg-lisp.md](./hg-lisp.md) | Designs, programs, and descriptions of another implementation. Their `src/hg` paths and implemented-status claims describe that implementation. |
| Supplied TypeScript samples (removed October 11, 2026) | Reviewed composition examples; their useful details and conflicts are recorded here. They were not executable engine modules or a consistent specification of every rule in the Markdown references. |

## Agreed numeric conversion change

Numeric construction clamps finite inputs to the destination range. Integer
construction truncates toward zero first. This applies to scalar constructors
and vector components, including WGSL conversions. Finite host `f32` inputs clamp
before existing single-precision rounding; matrix construction uses the same
component conversion.

| Destination | Range |
| --- | --- |
| `i32` | -2147483648 through 2147483647 |
| `u32` | 0 through 4294967295 |
| `f32` | `-(2 ** 128 - 2 ** 104)` through `2 ** 128 - 2 ** 104` |

For example, `(i32 4294967295)` returns `2147483647`, `(u32 -1)` returns `0`,
and `(vec2u (vec2i -1 2))` produces components `0, 2`.

The exact maximum matters: rounding the reference's approximate decimal
`3.4028235e38` with `Math.fround` produces infinity. WGSL float-to-integer conversion
needs upper threshold checks before casting: `f32` rounds the integer maxima up
to `2147483648` and `4294967296`. Integer-to-integer conversions clamp in the source
integer domain, preserving full-width precision.

Existing provided-value conversion rules, float rounding, and guard timing remain
in place except for the agreed string parsing and defaults below. All numeric
constructors and guards now require finite values, as agreed below. Guards
validate without conversion. Integer operations retain
wrapping, float operations round, and ordinary scalar arithmetic uses JS numbers;
non-finite host results are rejected. Clamping construction does not introduce
saturating arithmetic.

Native `Uint32Array` conversion wraps integers; `Uint8ClampedArray` clamps its
8-bit inputs. Mercury follows the owner's clamping preference rather than
claiming to duplicate `Uint32Array` conversion.

## Agreed immediate f32 rounding

Keep immediate single-precision rounding. Scalar `f32`, float-vector, and matrix
construction clamp finite inputs to the destination range and then apply
`Math.fround`. Host values do not retain additional JS precision until GPU upload.
For example, `(f32 0.1)` returns `0.10000000149011612`.

`f32?` and f32 assertions require a finite value already representable in single
precision; they validate without rounding. Thus `0.1` fails the guard, while
`Math.fround(0.1)` passes. This retains the current engine contract rather than
the reference's range-only query. Ordinary `num` values keep JS precision.

## Agreed native collection representation

Lists are regular JavaScript arrays. Dictionaries are plain untyped objects;
object literals and null-prototype objects supplied by JS callers are accepted
directly. Construction, access, mutation, copying, equality, guards, iteration,
and browser services use these representations. Passing a collection between
JS and Lisp preserves its identity. Dictionary fields such as `type`, `values`,
and `__cells` are ordinary keys; own-property reads exclude inherited names,
and writes safely support `__proto__`.

Deferred token/text snapshots use sparse native arrays with builders held in
private weak metadata. `Data.get` builds one entry; `Data.values` materializes
the array before direct JS iteration or serialization. Module namespaces use
plain objects holding shared `{ value }` cells, identified through private weak
metadata. Explicit reads/writes preserve live imports without property accessors.

Matrices, structs, packed arrays/many, and opaque resources retain their storage
representations. Dictionary construction follows the agreed rules below.
Access/mutation key validation, bounds, and empty collection truthiness retain
existing rules.

## Agreed named vector fields

Standalone vectors use plain records with a canonical `__type__` tag and named
components: `{ __type__: 'vec3f', x: 1, y: 2, z: 3 }`. They have no component-array
backing field. All nine vector families use the constructor rules agreed below
and retain immediate rounding/clamping, guards, arithmetic, copying, equality, numeric indexing, and
swizzles. Generated arithmetic and swizzles share the numeric constructor and
explicit component operations.

`Data.values(vector)` returns a component snapshot. Direct JS writes to named
fields change a standalone vector; `Data.put` validates and applies the existing
component rules. Packed vectors and matrix-column vectors remain explicit shared
views identified by `__type__` and owner metadata. Reads/writes follow their
original storage and revision rules, without getters or stale named-field copies.
Copies and serialization materialize ordinary named vector records.

Language kind registration still follows identity. A plain object carrying an
`__type__` field, including a decoded JSON vector, remains a dictionary until
explicitly constructed as a vector. Matrix representation remains unchanged.

## Agreed native JSON and finite numbers

`to-json` writes lists as JSON arrays and dictionaries as JSON objects.
`from-json` returns ordinary parsed values, without recognizing or restoring
typed tags. Typed values encode as regular JSON data: vectors use `__type__` and
named fields; matrices retain `type`/`values`; structs encode their fields; packed arrays
and many encode their live elements. Explicit snapshots exclude engine ownership
metadata and materialize deferred entries. No runtime registration, storage
layout, capacity, or live alias is restored by decoding. Dictionary keys are
unrestricted, including fields that resemble typed records.

NaN and positive/negative infinity are rejected by numeric constructors, queries,
guards, source literals, language numeric boundaries, writes, and host arithmetic
results. Decimal overflow is rejected, including JSON exponent overflow that
`JSON.parse` would otherwise turn into infinity. Finite constructor inputs still
clamp to the destination range. Shader uploads/literals require finite values;
GPU computations remain subject to WGSL's runtime rules.

Native JSON number precision applies. Encoding negative zero produces `0`.
Cycles, functions, undefined, sparse holes, and opaque resources remain rejected;
repeated references decode as independent data. This is a data interchange format,
without automatic schema or resource reconstruction.

## Agreed scalar constructor defaults

Scalar constructors accept zero or one argument. With no argument, `num`, `f32`,
`i32`, and `u32` return `0`, `bool` returns `false`, and `str` returns `""`.
The same defaults apply to direct JS calls and Lisp calls through function values.
Shader-supported `f32`, `i32`, `u32`, and `bool` constructors also accept no
argument; `num` and `str` remain host-only types.

Provided arguments retain existing conversion rules. An omitted value is distinct
from an explicitly supplied nil/undefined: numeric conversions still reject those
values, and `(str nil)` still returns `"nil"`. More than one argument is rejected.
Queries and assertions continue to require exactly one value.

## Agreed boolean literals

Keep `true` and `false` as reserved literals. Reading them produces primitive
JavaScript booleans directly, without looking up a binding. Neither name can be
declared, assigned to, or shadowed by a local binding or function parameter.
Host-supplied bindings do not override these literals. This retains the current
engine behavior instead of adopting the reference's symbol representation.

## Agreed nil construction

Both bare `nil` and zero-argument `(nil)` produce JavaScript `null`. The compiler
recognizes `(nil)` directly and rejects arguments. `nil` remains a reserved literal;
it cannot be declared or shadowed. Null values are not first-class functions.
Existing nil assertions, JSON encoding, and no-value paths retain their behavior.
Shaders continue to reject nil values except for the agreed vector-constructor
zero initialization described below.

## Agreed strings and templates

Use `$"..."` for templates, replacing `f"..."`. Keep single-brace Lisp expression
interpolation, left-to-right once-only evaluation, native JS conversion to text,
and doubled braces for literal braces. Plain double-quoted strings do not interpolate.
Nested templates use the same dollar prefix.

Both ordinary strings and template text accept modern JavaScript string escapes:
the existing JSON escapes plus `\v`, `\0`, `\xHH`, `\u{H...}`, escaped single quotes,
and nonnumeric identity escapes. Backslash followed by LF, CR, CRLF, U+2028, or
U+2029 is a line continuation and contributes no character. Unescaped LF/CR remain
invalid. Hex escapes require two digits, fixed Unicode escapes require four,
and braced Unicode escapes require a code point no greater than U+10FFFF.
Legacy octal and other numeric escapes are rejected; `\0` cannot precede a digit.
Escaped braces and braces inside Unicode escapes are literal template text.
The compiler and tolerant editor tokenizer share escape boundaries.

Escape syntax does not become part of the runtime string value. Native JSON
serialization preserves the resulting characters using JSON-compatible spelling:
`"\x41"` encodes as `"A"`, and `"\v"` as `"\u000b"`. Control characters and lone
surrogates remain serializable. `from-json` still uses JSON syntax and rejects
JS-only escape spellings. Generated JS protects decoded template text, including
carriage returns, backticks, and literal `${` sequences.

## Agreed numeric parsing and conversion suffixes

Numeric strings use JavaScript `Number` parsing after trimming their body, with
decimal/exponent, hexadecimal (`0x`), octal (`0o`), and binary (`0b`) forms.
An optional `:i`, `:u`, or `:f` suffix selects `i32`, `u32`, or `f32` conversion.
For example, `(num "0xff:u")` returns `255`, `(num "1.9:i")` returns `1`, and
`(num "0.1:f")` returns `0.10000000149011612`. The suffix applies the shared
clamping and immediate-rounding rules; an outer scalar constructor subsequently
applies its own conversion. Nil and non-primitive input rules remain unchanged.

Source literals support these numeric bodies with the same colon-letter suffixes:
`0xff:u`, `10:i`, and `0.1:f`. The colon is required to distinguish suffixes from
hexadecimal digits. Literal suffixes are adjacent to the body and converted during
reading; values remain primitive JS numbers. The AST records the scalar type so
WGSL emission preserves signed, unsigned, or float literals. Unsuffixed shader
numbers retain existing f32 lowering. Full type annotations such as `value:f32`
and `(value : f32)` retain their existing meaning.

Empty strings/bodies, partial numbers, unknown or repeated suffixes, NaN, and
infinities are rejected. Parsed overflow is rejected before clamping. Strings may
have whitespace around the body and suffix; source suffixes contain no whitespace.

## Agreed empty collection truthiness

Keep existing boolean conversion: empty native lists and dictionaries, and many
with zero active elements, are false. Nonempty collections are true even when
their elements are false or nil. Many truthiness follows active length, not
allocated capacity. Adding or removing elements changes the next truthiness check.

`bool`, conditions, loops, and `and`/`or` share these rules. Shader many values also
use active length. Nil, false, numeric zero, and empty strings remain false;
numeric values must be finite. Vectors and matrices remain true, including zero
vectors/matrices. This retains the engine's behavior instead of adopting native
JavaScript truthiness for empty arrays and objects.

## Agreed dictionary construction

Dictionary construction keeps the agreed overloads and pair handling, with the
owner's subsequent correction requiring string keys:

| Input | Result |
| --- | --- |
| `(dict 42 "value")` | Type error: keys must be strings. |
| `(dict (str 42) "value")` | `{ "42": "value" }` through explicit conversion. |
| `(dict "x")` | `{ x: null }` |
| `(dict existing-dict)` | The same dictionary object, without copying. |
| `(dict (list "x" 1))` | `{ x: 1 }` |
| `(dict)` or `(dict nil)` | A fresh empty dictionary. |

Direct JS calls also accept a single undefined as empty. A single native list
supplies alternating keys and values; deferred list entries use explicit reads.
An unmatched final key receives nil, and duplicate keys retain the last value.

Keys must already be primitive strings. This supersedes the earlier approval of
implicit `str` conversion. Ordinary call evaluation resolves key expressions
before invoking the constructor; variables and expressions that produce strings
are accepted. `Data.dict` validates values, without evaluating source or invoking
coercion hooks. Numbers, booleans, nil, objects, and functions in key positions
are rejected, including keys supplied through a list. Explicit `(str value)`
conversion remains available. Stored values retain existing language validation
and undefined-to-nil normalization. Dictionary identity inputs retain their
contents unchanged. Access and mutation also require string keys. Dictionaries remain plain untyped objects with unrestricted keys,
including `__type__`, and safe own-property writes for `__proto__`.

## Agreed vector construction

All nine vector families and their existing aliases share these rules:

- No arguments, or a single nil/host undefined, produce a zero vector.
- A single scalar number splats into every component: `(vec3f 1)` is `(1, 1, 1)`.
- Other inputs recursively flatten numeric scalars, lists, and vectors in order,
  including nested lists and vectors inside lists.
- Missing components receive trailing zeros; extra components are ignored.
  An exact component count is not required.
- Construction always allocates a vector copy with the target type's numeric
  clamping and immediate-rounding rules. Shared views use explicit reads.

Examples: `(vec4f (vec2f 1 2))` is `(1, 2, 0, 0)`, `(vec2f (vec3f 1 2 3))`
is `(1, 2)`, and `(vec3f 1 (list (list 2) 3 4))` is `(1, 2, 3)`.
A single list with one number pads rather than splatting: `(vec3f (list 1))`
is `(1, 0, 0)`. Empty lists contribute no components. Unsupported values in the
consumed input and cyclic lists encountered during flattening are rejected;
consumed numeric values must be finite. Deferred list entries are read explicitly.

WGSL lowering applies the same component ordering, padding, trimming, and scalar
splat to shader expressions and inline nested `(list ...)` syntax. Nil and `(nil)`
as the single constructor input lower directly to zero initialization. Runtime
list values and nil shader parameters remain unsupported. Vector expressions
are evaluated once when selecting their retained components.

These decisions adopt recursive flattening from the samples and explicitly allow
flexible component counts, replacing the prose's flat-list/exact-count restrictions.

## Agreed access and explicit lookup

Adopt the reference's computed dot selectors and explicit lookup form. `(get name)`
resolves the same binding as bare `name`, with the same lexical scope, shadowing,
temporal initialization checks, and live module cells. `(get name.x)` also works,
including chained and computed paths such as `(get name.(get key).x)`. `get` takes
exactly one symbol or access path; it is a compiler form, not a first-class function.
The old two-argument Lisp collection `get` is removed. JS `Data.get(value, key)`
remains the explicit storage operation.

Bare dot suffixes remain literal: `dict.name` selects key `"name"`. Parenthesized
selectors evaluate an ordinary Lisp value expression: `items.(+ i 1)` computes an
index, and `dict.(get key)` resolves a string key. Selectors can be chained and
used as `set` targets. A selector's parentheses are the expression's call syntax;
they do not turn a numeric or string literal into a callable value. Brace blocks
remain statement-only. Each target, selector, and assignment value is evaluated
once in source order; computed selectors may await in asynchronous host code.

Retain existing storage checks: dictionaries/records/structs require string keys;
indexed values require integer numbers within bounds, without string coercion.
Dictionary misses return nil and insertion through `set` remains allowed. Keys
such as `__type__` and `__proto__` retain the approved ordinary-dictionary rules.
Computed numeric vector indices select components; matrix indices select live
columns, matching literal dot access. Quoted vector swizzles remain invalid.

Shader `get` uses the same single-name/path syntax. Computed scalar indices work
for supported arrays/many, vectors, and matrices. Existing storage inputs remain
read-only. Local computed writes validate the index at runtime and ignore invalid
indices; computed reads return a zero-initialized value for invalid indices, as
existing shader collection reads do. Struct and resource fields retain statically
named selectors; runtime string selectors are unsupported in WGSL. Existing
literal-index and type checks remain in place. Editor and existing callers use
the new access syntax.

## Agreed function results and early returns

Functions implicitly return their final value expression. For example,
`((fn (x) (+ x 1)) 4)` returns `5`. The same rule applies to async functions,
callback functions, and existing promise-chain handlers. Returning a promise
retains native async adoption; successful `finally` cleanup still preserves the
preceding outcome. Promise construction and explicit settlement follow the agreement below.

Empty host functions and bodies ending with a statement without a value return
nil. A final brace block remains a statement scope and contributes no result;
its last inner expression is not returned. Existing statement-position `if`,
loops, declarations, and callback registrations retain their statement behavior.
Assignment, calls, and ordinary value expressions can supply a final result.

Explicit `(return value)` exits the enclosing function or handler immediately,
including from within a brace scope or loop. Bare `(return)` exits with nil on
the host. Neither form is required for a final value expression. Argument count,
statement-position checks, lexical captures, parameter guards, source tracing,
and evaluation order retain their existing rules.

Shader helpers and fragment shaders also accept a final typed value expression.
Earlier explicit returns and the implicit final result must agree in type, and
all paths must produce a supported value. A fragment result must be vec4f.
WGSL nil results, empty/non-value helper bodies, and bare shader `(return)` remain
unsupported under the existing typed-result contract. Braces do not acquire an
implicit return boundary or value on either target.

## Agreed promise construction and settlement

Adopt separate forms: `async` accepts one function and wraps it without invoking it;
`promise` defers its body and chains repeated `then`, `catch`, and `finally` clauses.
Function values and literal `fn` definitions both support async wrapping with their
existing arity metadata and callback restrictions. All stages can await.

Promise bodies and handlers retain normal implicit/explicit function returns.
An empty or non-value body resolves to nil. `return` remains an ordinary early
function return; it has no special settlement overload. Prefer `(resolve value)`
or `(reject reason)` to explicitly exit the current stage. Both take zero or one
argument, defaulting to nil. Resolution adopts promises; rejection invokes the
stage's rejection callback without throwing. Each form exits the function executing it, skipping
that function's remaining statements.

Settlement belongs to the current promise body or handler, including nested brace
scopes and loops. Nested ordinary and async functions retain their own return boundary, but capture
the nearest enclosing stage for settlement. A settlement call exits the nested
function and settles that captured stage; the caller continues normally. Nested
promises establish their own target. First settlement wins, including normal body
completion; a later callback cannot change an already settled stage. Both `resolve`
and `reject` are invalid outside a lexically enclosing promise body or handler.
Stage settlement
forms require statement position and cannot exit a text builder. They are host-only, with explicit
shader diagnostics. No settlement callbacks are injected into lexical bindings.

Body statements extend to the next bare chain marker; a single outer brace block
acts as the stage body, while nested blocks remain statement scopes. `then` and
`catch` take zero or one parameter; `finally` takes none. Handler bodies remain
required. Catch recovery and finally cleanup follow native promise ordering:
successful cleanup preserves the preceding outcome even when explicitly resolved;
rejected cleanup replaces it. Initial body evaluation remains deferred.

The owner confirmed normal completion remains supported: explicit settlement exits
the stage, and a stage without those forms settles from its normal result. Existing
`async?`, `async-all`, and `async-race` names remain. Catch receives the custom error
records agreed below; explicit failures use `reject` under the agreement below.

## Agreed caught-error representation

Catch receives a custom plain record with exactly the initial fields
`{ __type__: "__error__", name: "Error", message: "oops" }`. The registered language
kind and assertion name are `error`; it is distinct from an untyped dictionary.
Native JavaScript Error instances remain internal to exception/diagnostic handling
and are converted at the catch boundary, retaining their name and message. Other
rejection reasons retain existing string conversion with the default name `"Error"`.
Already constructed error records pass through catch unchanged, so rejecting a
caught record again preserves its identity and fields.

`Errors` owns explicit construction/conversion and query operations. Native origins
are private weak metadata, preserving existing rethrow traces without exposing
native objects or adding methods to the record. `error?`, assertions, and typed
handler parameters follow the existing query/guard conventions. Named and computed
access, copying, equality, and JSON encoding handle these records. Language writes
to `name` and `message` require strings and retain the tag. JSON decoding stays
plain data, without automatic type restoration; explicit `Errors.from` can convert
an error-shaped dictionary. No constructor binding is introduced by this decision.

This decision replaces the catch dictionary adapter, rather than exposing arbitrary
rejection reasons directly. Explicit failure now uses `reject`, as agreed below.
Existing native exception boundaries and unhandled rejection contracts are preserved.

## Agreed explicit rejection without throw

Omit the Lisp `throw` binding. Explicit rejection does not throw its reason.
Both `resolve` and `reject` require a lexically enclosing promise body or handler.
Nested functions can capture and settle that stage; top-level calls and functions
defined outside a promise cannot use either form. This supersedes the briefly
supported standalone rejected-promise expression. No standalone JS rejection
factory is exposed by `Promises` either.

Inside a promise body or handler, including lexically nested functions, `reject`
invokes that stage's captured reject callback and exits the function executing
it. `(reject)` uses nil; more than one argument remains a syntax error. This
retains stage settlement and first-settlement rules without creating a separate
rejected promise merely to reject an already owned stage. Use
`(promise (reject reason))` to construct a rejected promise. Settlement remains
statement-only and host-only; ordinary `return` retains its existing behavior.

The callback preserves the supplied reason, including custom error record
identity. The catch adapter still converts reasons to custom error records.
Runtime validation, native failures, and diagnostics retain their established
exception boundaries. Existing callers use rejection inside promises.

## Module composition informed by the examples

The useful pattern in the samples is a type namespace containing a constructor,
query, and assertion, with optional conversion and collection operations. Each
operation receives its value explicitly. Construction creates data, a query
reports a mismatch, and an assertion validates and returns the same value.
Those responsibilities should remain distinct.

In this engine, these responsibilities are distributed among `Data`,
`Conversions`, `NumericTypes`, `Types`, `Structures`, and generated `TypeBindings`.
Refactoring them into per-type namespaces can preserve behavior, but choosing
names and exposing them to Lisp still requires agreement. The reference's
`query`/`maybe` naming is itself inconsistent.

The following dependency boundaries guide that work:

1. Numeric metadata and primitive conversion rules form the base. They do not
   depend on App, browser services, or the language binding map.
2. Construction and explicit storage operations share those rules. Packed views
   preserve aliasing, ownership, revision tracking, and validation.
3. Queries and assertions consume current values. They do not convert or install
   background mutation checks.
4. Binding assembly chooses approved language names. Static generated families
   map those names to shared operations; importing a type should not populate a
   process-wide mutable registry.
5. Compiler lowering consumes type rules and target-specific layouts. Tokenization
   and parsing remain usable without App or GPU initialization.
6. App owns clocks, module caches, editable text services, and runtime resources.
   Browser adapters accept owned records explicitly.

These are logical boundaries within the flat `hg/` folder. A new module
should represent a domain with a coherent namespace, rather than recreate
`src/hg/data` nesting or create a file for every individual operation.

Expose the same approved namespace object to JS and Lisp. Representation adapters
must preserve value identity and operation semantics. App-dependent factories
receive the owner explicitly or use a clearly identified app-owned binding
adapter. Exposure must not introduce a current-app singleton.

The samples' `Type.__table__` and `ref.ts` table are module singletons. An extensible
type registry must be explicitly supplied and owned; built-in families can be
static. The owner ruled out a generic reference registry, as recorded below.
Serializing a UUID alone cannot restore its native resource. These examples do
not establish a `ref` binding.

## Agreed boolean host/GPU restriction

Boolean values cannot cross the host/GPU boundary, even through numeric encoding.
Shader parameters reject `bool`, `array<bool>`, and `many<bool>`, along with structs
containing boolean fields or elements at any nesting depth. Compilation reports the
offending parameter; direct JS shader creation and GPU packing enforce the same rule.

Host boolean values, structs, and collections remain usable on the CPU. Shader
locals, local struct fields and array/many elements, and helper parameters/results
remain boolean values and lower directly to WGSL `bool`. The uniform and shared
storage encoding/decoding workaround is removed. A caller may explicitly supply a
numeric parameter and convert it with `(bool value)` inside the shader.

## Agreed type introspection

`(type value)` evaluates exactly one expression once and returns a plain string
with a double-underscore prefix and suffix, such as `"__dict__"` or `"__list__"`.
Scalar `num`, `f32`, `i32`, and `u32` values all report `"__num__"`, without tagging
or distinguishing JS numbers. Vectors and matrices retain their canonical type names;
registered structs, packed collections, errors, promises, functions, textures, and binding handles
report their corresponding Lisp types. Type queries do not restore tagged JSON:
a plain dictionary remains `"__dict__"` even if it has a `__type__` field.

The form is available in host code. Its string result is not supported by WGSL.
`Types.type(value)` exposes the same operation to JS callers. Host records report
`"__dict__"`; unsupported native objects and non-finite numbers are rejected.

## Agreed shader helper captures

Shader helpers capture outer shader locals and helper parameters by lexical binding.
Their declarations remain at WGSL module scope. Hidden parameters pass the current
value at each call when the helper and its callees only read a capture; captures
that may be written use `ptr<function, T>` and share the original variable. Field,
component, and bounded many edits count as writes to that variable. Capture/write
requirements propagate through nested calls; lazy selectors preserve these rules
and short-circuiting. Distinct lexical bindings remain distinct even when shadowed.

Explicit helper parameters still pass by value, with mutable local copies; nested
helpers can capture those copies. Helper calls may discard their results in statement
position. Every helper still requires a typed return on every path. Uninitialized
binding access, recursion, function aliases/values, and implicit scene-variable
captures remain unsupported. This decision does not introduce raw `js` or `gl` forms.

## Deferred raw source forms

Leave `(js ...)` and `(gl ...)` unimplemented for now. Their source syntax,
escaping, access to surrounding bindings, result types, and resource handling
remain open. Revisit them when a concrete use case needs raw target-language
source; this deferral does not approve the reference's proposed forms.

## Agreed scene execution split

Adopt `App.serve(app, source)` to initialize fresh scene memory and
`App.patch(app, source)` to replace scene code while preserving scene memory.
Both keep the existing app, its shared `state` dictionary, and app-owned services.
Retain the existing source-text argument, optional `sourceURL`, readiness waiting,
and promise result resolving to the app. This decision does not approve a new
store, reflection API, or additional lifecycle controls.

Implemented: match top-level `let` bindings by name, retain compatible existing data values
without evaluating their new initializers, initialize new names, remove missing
names, and replace function/shader definitions. Function-local and block-local
bindings are not preserved. New closures use new binding cells; retained objects
keep their identity. Struct definitions and callbacks are rebuilt.

Explicit annotations use the existing guards. If the previous value fails the
new binding's guard, evaluate the new initializer once and validate its result.
Compatible and unannotated values remain preserved. No conversion of old values
is performed. App state, imported module memory, and resource ownership keep
their current contracts. Removing or reinitializing a binding does not dispose
its resources. Resource owners remain responsible for cleanup, as agreed below.
Shared data uses `app.state`, as agreed below. Reflection's initial scope is
top-level scene bindings, with the implemented inspect/read/write contract below.
Additional lifecycle APIs remain open.

`App.load` is replaced by `serve` and `patch`. Both accept source text and optional
`sourceURL`, wait for readiness, and resolve to the app. The playground exposes
both operations; the editor starts with `serve` and updates itself with `patch`.
See [the implemented contract](./APP.md#serving-and-patching).

## Agreed presentation background

Let the outer canvas or its parent determine the visible background. Clear the
outer bitmap before presenting each image, leaving unused pixels transparent
when the destination context supports alpha. Give runtime-created canvases a
black CSS background; preserve the styling of supplied canvases. Hosts can use
their own canvas background or let their parent's background show through.

This changes letterbox borders. The rendered GPU image retains its existing
opaque presentation. Sizing, centering, and scale increments keep their current
behavior; smoothing is defined separately below.

## Agreed image smoothing option

Add boolean `is` for image smoothing. It defaults to false, preserving current
nearest-neighbor presentation. True enables smoothing regardless of the scale
increment; smoothing is not inferred from `si`.

Accept it in `App.new` options, through ordinary `app.is` edits, and in Lisp
`(configure is true)` or dictionary configuration. Reject non-booleans, including
nil. `(configure)` includes the requested setting. Changes apply at the next
frame boundary and trigger presentation of the existing image even when the
scene has not drawn a new frame. Rendering dimensions and feedback textures
are unaffected by a smoothing-only change.

## Agreed canvas sizing ownership

Adopt the reference ownership rule: preserve supplied canvas `width` and `height`
and let the host manage its bitmap. CSS resizing alone does not change that
canvas's rendering resolution. Runtime-created canvases fill the viewport and
size their bitmaps from CSS bounds multiplied by device pixel ratio, rounded
with a minimum of one pixel per axis.

Automatic rendering axes follow the destination bitmap. Frame preparation
consumes host bitmap changes and updates automatic inner dimensions using the
existing resize callback and GPU limit rules. Presentation uses bitmap pixels;
input and caret positioning retain their existing CSS/bitmap conversions.
The editor JS host now owns its canvas resizing, preserving its previous
layout in CSS pixels.

## Agreed opaque handle typing

Opaque texture handles must identify their own language type rather than appear
as empty dictionaries. Shader outputs, `context.before`, and text textures now
carry `__type__: '__texture2d__'` on runtime-created handles. `(type image)` reports
`"__texture2d__"`, `(texture2d? image)` recognizes the registered handle, and host
code can read `image.__type__` or `(get image.__type__)`. Language writes to texture
metadata remain invalid. Existing texture annotations use the same identity guard.

Registration remains authoritative: a plain dictionary carrying the marker is
still a dictionary, and editing a handle's JS marker does not change its registered
type. Registered caller-frozen handles need no mutation; explicit Lisp access
returns their type marker. Resource ownership and lifetime checks remain unchanged,
and JSON cannot serialize or restore handles. Host records still report dictionaries;
functions and promises retain their existing distinct types.

This change does not introduce the reference's UUID table, acquire/resolve/release
operations, or `texture3d`. A generic ref registry was subsequently ruled out;
`texture3d` was deferred, as recorded below.

## Agreed resource cleanup ownership

Keep cleanup with the resource's owner. Removing or reinitializing a binding
during `App.patch` does not dispose its resource, transfer ownership, or infer
that all references have disappeared. Patching does not trace collections,
closures, app state, or references held by JS hosts to decide disposal.

Existing resource lifetime rules remain in force, including borrowed frame
handles, graphics-owned caches and finalization, and app disposal of owned
resources. Retaining a borrowed handle does not extend its lifetime. No new
scene ownership or explicit release API is introduced. The current implementation
already follows this policy, so this decision requires documentation only.

## Agreed shared app state

Prefer the existing `app.state` dictionary over the reference's separate `Store`
proposal. Each app starts with its own plain dictionary, accessible as the same
object in JS and Lisp. Both `serve` and `patch` preserve it. Scene authors explicitly
put data there when it needs to survive a fresh scene; ordinary scoped bindings
retain their established lifetimes.

Reads and writes use existing dictionary rules and preserve live value identities,
without snapshot copying. Saving remains explicit and follows the existing JSON
contract; not every in-memory value is serializable. Storing a handle does not
transfer resource ownership or extend a borrowed lifetime. No new `Store` namespace
or persistence backend is introduced. Existing runtime behavior already provides
this contract, so the decision requires documentation only.

## Agreed initial reflection scope

Keep reflection limited to top-level scene bindings for now. This includes data,
function, shader, and resource-valued bindings in the active scene. Block-local
and function-local variables, captured locals, and active call frames remain
deferred. `app.state` remains ordinary accessible app data; this decision does
not add it as a separate reflection root.

The scope decision alone does not establish reflection operations or result schemas;
the subsequently selected live binding model and reference lifetimes are recorded
below. Its implemented schema and write validation are recorded below as well.
No GPU readback is introduced by selecting this scope. Callable execution was
subsequently agreed separately below.

## Agreed live binding reflection

Prefer live binding references over snapshots of binding values. `App.inspect`
enumerates references to the active scene's top-level bindings. `App.read` observes
a referenced binding's current value, including changes made by scene code after
inspection. `App.write` explicitly replaces the binding's value; edits to copied
inspection metadata must not be presented as edits to live scene storage.

The same operation model is intended for JS hosts and Lisp editors. It does not
change source initializers or imply saving. Reference lifetimes are agreed below;
the subsequently implemented representation and write validation are recorded
below as well. Internal binding cells remain private.

## Agreed binding reference lifetime

References follow the same top-level binding name through committed `App.patch`
operations, including reinitialization after a failed type guard and replacement
of function/shader definitions. They identify the binding's current value rather
than preserve the old value or point permanently at an old scene cell.

| Committed operation | Existing reference |
| --- | --- |
| Patch keeps the binding name | Remains valid and follows the current binding. |
| Patch reinitializes the binding or replaces its code definition | Remains valid and reads/writes the replacement value. |
| Patch removes the binding | Permanently invalidated. |
| Later patch reintroduces the removed name | Old references remain invalid; the new binding has new reference identity. |
| Serve a fresh scene | All references to the previous scene's bindings are permanently invalidated, even for matching names. |
| Dispose the app | All of its binding references are invalidated. |

Uncommitted candidate scenes must not retarget or invalidate active references.
This contract concerns inspector references to bindings; it neither extends
resource-handle lifetimes nor changes resource cleanup ownership. The concrete
schema and write rules are recorded in the implemented contract below.

## Agreed reflection writes and implemented surface

`App.write` follows ordinary `set` rules: initializer assertions do not become
persistent binding guards, so a mutable `(let count (1 : num))` can be replaced
with a string. Immutable struct definitions cannot be reassigned. Existing
language-value admission checks apply to external values before mutation, including
finite scalar numbers and supported object kinds. Returned collections and typed
values keep their identities and their normal mutation/storage rules.

Implemented in JS and Lisp:

| Operation | Result |
| --- | --- |
| `App.inspect(app)` | Fresh plain dictionary keyed by top-level binding name, containing live handles. |
| `App.read(app, reference)` | Current binding value without snapshot copying. |
| `App.write(app, reference, value)` | Replaces a mutable binding value and returns it. |

The operations are synchronous and require exactly their listed arguments. Each
handle is a registered record `{ __type__: '__binding__', name }`, with read-only
Lisp metadata. `(type reference)` returns `"__binding__"` and `binding?` recognizes
its registered kind, independently of whether it is still live. Ordinary dictionaries
with matching fields are not handles; forged, wrong-app, and invalidated handles
cannot read/write bindings. Copying preserves handle identity and JSON rejects
handles. No UUID table or generic acquire/release registry is introduced.

Inspection discovers bindings in the committed scene and returns an empty dictionary
before the first commit. Editing its dictionary entries does not edit scene bindings.
References are updated at successful scene replacement, so failed/superseded
candidates do not retarget them. Removing a binding or serving a fresh scene
permanently drops old reference targets. See [the full App contract](./APP.md#live-binding-reflection).

## Agreed reflected function invocation

Support both ordinary invocation of function values returned by `App.read` and
`App.call(app, reference, args)`. The latter requires exactly three arguments,
including a native argument list (empty for zero arguments), resolves the current
live binding using the same owner/lifetime checks, and requires a callable value.
Arguments use normal language-value admission while preserving compound identities.

Call executes immediately in the function's existing lexical environment, retaining
its parameter checks, ordinary result, original promise identity, and error/rejection
behavior. It does not resume scheduling, queue execution, or add implicit app/context
arguments. Shader invocation still follows normal context and resource checks.
Calls through a handle follow replacement functions after a patch; functions saved
from `App.read` remain their particular function values. Top-level injection is
covered separately below.

Implemented through the shared JS/Lisp App namespace and documented in
[the App contract](./APP.md#live-binding-reflection).

## Agreed pause/start scheduling

Adopt `App.pause(app)` and `App.start(app)` for automatic updates and rendering.
Pause cancels queued browser frames and event-triggered render requests, discards
update backlog and the previous frame timestamp, and preserves the scene, binding
references, state, resources, and elapsed simulation clocks. Start resumes with a
fresh time baseline; paused wall time does not cause catch-up updates. Repeated
starts do not add loops or reset an already running clock.

Both operations require one live app and return it synchronously. Apps default
to unpaused; `app.paused` observes the explicit state. It can be selected before
readiness or scene attachment. Source replacement preserves explicit pause;
ordinary lifecycle callbacks and traced initial-render validation still run.
Scene replacement retains its existing clock-reset policy, while pause/start do
not detach or reattach. Async attach can finish while paused without scheduling.

Reflection and explicit `App.call` remain usable. Native input/edit delivery
retains its current behavior, while automatic renders are suppressed. Pause does
not cancel already executing functions or promises. Runtime failures remain a
separate stop condition: start rejects failed apps rather than clear their error
state; source replacement retains existing recovery rules.

Implemented in the shared JS/Lisp App namespace. See
[the App contract](./APP.md#pausing-and-starting).

## Agreed top-level injection

`App.exec(app, source)` runs as top-level code in the target app's current runtime,
without editing or appending to its stored source. Existing binding cells are shared;
new top-level `let` and `struct` declarations persist, enter reflection, and are
available to later injections. Functions and blocks provide ordinary local scope.
Duplicate declarations are rejected; ordinary `set` updates mutable bindings.
Existing compiled functions keep their original lexical environment.

Top-level callbacks update the active scene, and standalone imports extend its
import environment. Execution uses the target's existing services and resource
ownership. It runs immediately while paused and returns its final expression or
nil for a final statement. Top-level await returns a registered promise.
Errors propagate without automatic scene failure; completed effects are not rolled
back. Later top-level statements and async completion reject when their target
scene is no longer active. A committed, initialized scene is required.

Injected bindings follow ordinary `patch` name matching/removal and fresh `serve`
reset rules; neither operation incorporates injected code into the source.
See [the implemented contract](./APP.md#top-level-execution).

## Agreed generic events and named hooks

Scene `on` declarations define named hooks, invoked directly by runtime services
using their existing contracts. Generic events use the independent
`Events.new/on/off/emit` dispatcher in JS and Lisp. Registration deduplicates the
same handler; each emission snapshots subscribers in registration order, and nested
emissions queue behind the current emission. Subscription changes affect subsequent
emissions. Synchronous callback failures propagate, discard pending emissions, and
leave the dispatcher reusable. See [the implemented contract](./EVENTS.md).

Namespace APIs continue to receive explicit instance data. The owner also approved
selected Lisp forms that imply the runtime instance owning their code. Capture that
app through the compiler/runtime environment, preserving ownership across function
calls and async continuations without global current-app state. On October 11,
2026, the owner deferred additional shorthand forms for a later batch covering
multiple operations together. This includes the proposed `pause`/`start` forms;
generic dispatchers do not yet have a designated implicit events context.

## Deferred declaration metadata

The owner deferred declaration metadata on October 11, 2026. Do not add the
proposed `App.describe` operation or expose binding mutability, declaration source
locations, or main-program/injection origin metadata in this pass. Reflection
continues to expose names, live handles, and values through the existing operations.

## Agreed handle identity without a generic registry

On October 11, 2026, the owner confirmed that a generic `ref` registry is not
needed. Keep registered JS object identity for texture and binding handles and
their existing ownership and lifetime rules. Do not introduce UUID reference
tables, a generic `ref` binding, or generic acquire/resolve/release operations.
This is a settled decision rather than deferred registry work. `texture3d`
is separately deferred, as recorded below.

## Agreed rendering backend

On October 11, 2026, the owner chose to retain the existing arrangement: render
on the app's WebGPU inner canvas and present the result on its Canvas 2D outer
surface. The reference's initial 2D buffer implementation does not replace this
backend. Existing shader behavior, canvas ownership, sizing, backgrounds, and
image smoothing keep their agreed contracts.

## Deferred 3D textures

On October 11, 2026, the owner deferred `texture3d`. Do not add a placeholder type
or implement 3D texture creation, uploads, or shader sampling in this pass. Retain
the existing `texture2d` surface; revisit 3D textures when requested.

## Deferred and future work

| Area | Current engine | Reference direction |
| --- | --- | --- |
| App extensions | `serve`/`patch` preserve top-level data by name and reinitialize values that fail new explicit guards; cleanup remains with resource owners; shared data uses `app.state`. Reflection implements live top-level handles and inspect/read/write/call. `exec` injects top-level code without editing source. Pause/start preserve explicit pause across replacement and avoid catch-up or duplicate loops. | Further lifecycle proposals remain open; declaration metadata, locals, and persistence backends are deferred. |
| Current-instance Lisp forms | Scene `on` defines named hooks; existing app-bound operations capture runtime services. Generic `Events` dispatchers are implemented separately. | Additional shorthand forms are deferred for a later batch covering multiple operations together. |
| Additional resources | Texture and binding handles use registered JS object identity; a generic `ref` registry is ruled out. | `texture3d` is deferred. |

Brace scopes, mutable lexical declarations, shadowing, temporal initialization
errors, explicit returns through braces, ordered evaluation, and boundary guards
already align substantially. Fragment-only shaders, helper hoisting, and the
distinction between host values and GPU layouts are useful shared foundations.
Remaining cases need individual target contracts; reference programs are not
automatically executable here.

## Conflicts within the supplied references

The TypeScript filenames below identify the reviewed samples, which have since
been removed. These observations remain as review history.

- `api.md` calls queries `maybe`, while samples and other sections use `query`.
  Prose requires exactly one query argument; some samples accept an omitted
  argument. `nil.query` defaults to the namespace object.
- Prose validates vector components; sample queries inspect only the tag.
  Samples recursively flatten lists and fill missing components through nil
  conversion, while prose rejects nested lists/missing components in some cases.
- `dict.ts` lacks the prose's dictionary identity/list overloads. Construction
  reserves `__type__`, but put/delete helpers do not enforce its proposed mutation
  rule. Prototype keys and own-property access need a contract for native objects.
- Prose describes JS boolean conversion; the sample only converts types with a
  `__bool__` hook. Lists/dictionaries do not supply that hook.
- `str.ts` manually surrounds JSON text with quotes without escaping it. Its
  numeric parser accepts empty bodies and ignores extra colon segments, unlike
  prose. `f32.ts` defaults to the nil namespace instead of a nil value.
- `type.ts` recognizes arrays/objects and known tags without payload validation.
  Recognition, queries, guards, and decoding need separate validation rules.
- `ref.ts` has a global table with manual release. Its UUID collision check treats
  stored undefined as absent, while acquisition checks own properties. Ownership
  and reference identity cannot rely on that implementation.

## Consistency pass

The October 11, 2026 pass reconciles the agreed contracts with module composition,
instance ownership, entry points, and documentation. It removes the scheduler's
dependency on app orchestration through explicit preparation injection, keeps
module execution from substituting app source fields, and retains committed scene
origins for relative imports and replacement defaults. Scalar comparisons now
reject non-finite inputs consistently with numeric guards. Unused compiler setup
and stale browser markers, fixture names, and documented paths are removed.

The current engine uses flat domain modules, plain records and namespaces,
explicit instance arguments, and complete dunder private names. Runtime state
belongs to apps and service records; module-level weak metadata tracks identities
and layouts. Data/Structures and Types/generated TypeBindings retain their value
dependencies; these do not select an app or hold its scheduling state.

Value representation, constructors, source syntax, function/promise results,
serve/patch, top-level reflection, exec, and pause/start have the decisions recorded
above. Proposed signatures in `API-DESIGN.md` and the alternate reference documents
remain proposals unless adopted here. Current-instance shorthand, declaration
metadata, local reflection, persistence backends, embedded output, raw interop,
and 3D textures remain deferred. Any later accepted change should migrate operations,
lowering, generators, examples, callers, and existing expectations together.

Static parsing covered 86 JavaScript files: 38 engine/host modules, five automation
scripts, and 43 existing test files. The structural style scan covered engine,
host, and automation code. Relative imports, local Markdown links across 13
documents, and HTML entry-point resources resolved. The repository has only
`hg`, `docs`, `examples`, and `editor` as top-level folders, with `hg/tools` and
`hg/tests` as the engine's only subfolders.

This pass does not add tests or run the existing test suites. Runtime behavior
has not been exercised by these static checks.
