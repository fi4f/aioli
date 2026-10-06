# Aioli

Run `npx serve` and open the page. Run executes source; output goes to the browser
console. The second textarea shows the exact generated function body, whose
arguments are `$bindings`, `$shaders` (cached shader values), `$assert` (strict
type assertions), and, in diagnostic
mode, `$debug` (the diagnostic helpers). A separate textarea shows generated WGSL.

## Graphics

The graphics surface is always a developer-supplied WebGPU canvas. Its size is
set by the HTML width/height attributes (640 × 480 in the editor). There is no Canvas 2D
or WebGL fallback. Initialization requests an adapter/device and configures the
canvas with the browser's preferred format. Run is enabled once graphics is ready.
Unavailable WebGPU, device loss, and GPU errors are shown in the page and console.
Use localhost via `npx serve`, or HTTPS.

The first graphics binding is `(clear red green blue)`, with three finite numeric
channels between 0 and 1:

```lisp
(clear 0.1 0.2 0.4)
(print "Canvas cleared")
```

The canvas is opaque and initially black. Clear updates a color uniform and
submits a full-canvas triangle whose fragment shader returns that color.
The shader language below builds on this per-pixel rendering path; ray tracing
is not implemented yet. Scenes provide the animation loop. Browser services
live in `graphics.js` and supply ordinary bindings to the compiler.

## Embedding

The editor is a consumer of the library, not part of the runtime. Import the
ES module in an HTML script tag, create an instance, attach your canvas, and
provide source text or load a source file:

```html
<canvas id="demo" width="320" height="240"></canvas>
<script type="module">
  import { Aioli } from './aioli.js';

  const runtime = new Aioli();
  await runtime.attach(document.getElementById('demo'));
  await runtime.load('./examples/blue.lisp');
  // Or: runtime.setScene('(on render () (clear 0.1 0.2 0.4))');
</script>
```

Create one instance per canvas. Each owns its GPU resources, binding registry,
and compiled program closures. Run creates fresh program locals; retain a
returned function to retain its captured state. Custom host binding objects
are shared only if the developer supplies shared objects. `runtime.compile`
returns `{ javascript, run }` for inspection or repeated execution; constructor
options include `bindings`, `debug`, and `onError` (for asynchronous GPU errors).
Synchronous compilation/execution and loading errors throw to the caller.
Call `runtime.destroy()` to release GPU resources and canvas ownership.
Only one runtime may own a canvas at a time.

Open `demos.html` for two independent, differently sized canvases loading
separate Lisp files. No fullscreen requirement or editor elements are needed.

## Scenes and lifecycle

`runtime.load(url)` loads the initial scene or replaces the active scene.
`runtime.setScene(source)` activates source text. Scene data is declared with
ordinary `let`; lifecycle functions close over the same data:

```lisp
(let elapsed 0)
(on attach () (print "Attached"))
(on update (dt) (set elapsed (+ elapsed dt)))
(on render (context) (clear 0.1 0.2 0.4))
(on detach () (print f"Detached after {elapsed} seconds"))
```

`on` declares an optional callback at scene top level, once per callback name.
Bodies have the same implicit scope and explicit returns as `fn`. `attach` runs
once on activation; `detach` runs once on removal, replacement, or destruction,
before releasing GPU resources. Render runs once per browser animation frame,
after updates, receiving an opaque render-context handle for shader calls.
The handle is valid only during that frame, and is not an object-access API.
The first frame establishes the clock and renders with shader dt = 0 without updating.

Configure `new Aioli({ updateHz: 120 })` for fixed 1/120-second updates (default
60 Hz). `update` receives fixed dt; `render` receives the render context. Either
callback can use `()` to ignore its argument; `attach` and `detach` use `()`.
Inside shaders, dt follows actual frame timing, independent of catch-up limits.
Elapsed frame time accumulates, and every update receives
exactly `1 / updateHz` seconds. Fractional time carries into subsequent frames.
`maxUpdatesPerFrame` defaults to 8 to bound catch-up work; excess accumulated time
is retained rather than discarded, so a long pause can produce a backlog.

Compilation and top-level evaluation finish before detaching the old scene.
Failures in those stages leave its loop active, but top-level host effects are
not rolled back. Lifecycle failures stop the transition or loop; callback side
effects are not rolled back. Failed attach attempts invoke detach for cleanup.
Frame errors stop scheduling to avoid repeated errors. Asynchronous source loads
use latest-request-wins activation.

`runtime.run(source)` evaluates a standalone snippet without changing the scene.
`runtime.compileScene(source)` returns an inspectable compiled scene;
`runtime.activate(program)` evaluates and activates it with fresh scene locals.
Callbacks are synchronous. Run checks with
`node --test compiler.test.mjs scenes.test.mjs shader.test.mjs types.test.mjs`.

## Shader Lisp

`sh` enters a separate compiler that emits WGSL, not JavaScript. The first subset
supports numeric literals, `let`, `set`, brace scopes, explicit `return`, arithmetic
`+ - * /`, `vec2`, `vec3`, `vec4`, and component access `(x vector)`, `(y vector)`,
`(z vector)`, `(w vector)`, `(xy vector)`, `(xyz vector)`. A shader must return a
vec4 RGBA color. Locals are mutable and types are inferred from initializers;
assignment must preserve their type. There are no implicit scene-variable captures.

```lisp
(on render (context)
  ((sh ()
    (let uv (/ p (vec2 w h)))
    (return (vec4 uv 0 1))) context))
```

Built-in inputs are available in every shader: `p` is a vec2 of pixel-center
coordinates, with the origin at the top left; `w` and `h` are output dimensions
in pixels; `t` is elapsed scene-render time; `dt` is time since the previous frame.
Times are in seconds and start at zero. Dividing p by `(vec2 w h)` gives normalized
UV coordinates. No dimensions or time values are baked into shader source.

Numbers in shaders are f32, not the scene language's JavaScript numbers. Finite
f32 literals are supported; explicit NaN/Infinity constants are not implemented
in this subset. Scalar/vector arithmetic explicitly broadcasts the scalar;
different vector dimensions are rejected. Vector constructors accept the required
total components (including vector arguments), or one scalar to repeat.

Shaders are callable values with the render context first, followed by uniforms.
Shader parameters declare their types with colons. Numeric uniforms support
`float`, `vec2`, `vec3`, and `vec4`; resource parameters support `texture2d`:

```lisp
(let tint (sh (gain:float)
  (let uv (/ p (vec2 w h)))
  (return (vec4 (* uv gain) 0 1))))
(on render (context) (tint context 0.8))
```

Each sh expression compiles to a stable shader value per compiled program/runtime.
The GPU pipeline is created lazily once and reused by inline expressions across
frames. Changing uniform arguments or canvas dimensions does not recompile it.
Shader calls record fragment passes into owned textures and return borrowed GPU
texture handles. The last pass becomes frame output; the host presents after
render finishes, regardless of the callback's return value or subsequent logging.
Frames with no passes retain the previous image. A synchronous render failure
discards recorded passes and keeps the previous completed image. Resizing resets
the output textures. Buffers, offscreen targets, conditionals, and additional
uniform/resource types are future additions.

Pass an earlier shader output into a texture parameter to compose passes:

```lisp
(let gradient (sh ()
  (return (vec4 (/ p (vec2 w h)) 0.4 1))))
(let tint (sh (image : texture2d color : vec4)
  (return (* (sample image (/ p (vec2 w h))) color))))
(on render (context)
  (tint context (gradient context) (vec4 0.5 1 0.25 1)))
```

`sample` reads normalized UV coordinates with linear filtering, clamp-to-edge,
and mip level zero. Each pass has separate input and output textures. Resource
handles must come from the same runtime's current frame; stale handles and handles
from other canvases are rejected. Scene `vec2`, `vec3`, and `vec4` bindings construct
numeric vectors for uniform arguments. Vectors retain their declared dimensions;
GPU numeric inputs must be finite f32 values. Uniforms and textures follow the
declared parameter order and reuse the shader pipeline. See `examples/composition.lisp`.

Shader helpers use the same `let` and anonymous `fn` structure as scene code:

```lisp
(sh ()
  (let gradient (fn (uv:vec2)
    (return (vec4 uv 0 1))))
  (return (gradient (/ p (vec2 w h)))))
```

The compiler recognizes a `let` initialized with `fn` and lifts the function to
WGSL module scope. The binding is a static reference, not a GPU variable holding
a function. Calls compile directly to the lifted helper; no named-fn variant is
needed. Helper parameter types are `float`, `vec2`, `vec3`, `vec4`, or `texture2d`. Returns are inferred
and must explicitly return a scalar or vector; only the outer shader must return
vec4. Numeric parameters remain mutable through generated local copies; texture
parameters are GPU resource inputs and cannot be assigned.

Helpers can call other helpers and contain nested let-bound helpers. Generated
names preserve lexical scope and shadowing after lifting. Built-in shader inputs
and declared uniforms remain accessible; pixel position is passed automatically.
Other outer locals and parameters must be passed explicitly rather than captured.
Recursive cycles, argument type/arity mismatches, reassignment of helpers, and
using function references as data are compile errors. Anonymous helper calls and
function aliases are not implemented: bind each shader fn directly using let.
See `examples/gradient-helper.lisp` for a complete scene.

Colon annotations allow whitespace on either side: `uv:vec2`, `uv: vec2`,
`uv :vec2`, and `uv : vec2` are identical. Newlines and comments are allowed too.
Parameters are a flat sequence of name, colon, type; commas and the old nested
`(name type)` notation are not used. Missing/extra colons and unsupported types
produce Lisp source diagnostics. Colon is a dedicated reader token and cannot
occur inside ordinary symbol names; strings and comments are unaffected. Scene
`fn` and lifecycle callbacks can use optional annotations as described below.

`browser-shaders.test.mjs` checks real WebGPU pixels and pipeline reuse in Chrome.
It requires Playwright, pngjs, and the static server; run with those packages
available to Node (for example through NODE_PATH). AIOLI_URL can override localhost:3000.

## Compilation modes

Lisp diagnostics are enabled by default. Uncheck the checkbox to inspect and run
plain generated JavaScript. Changing the checkbox recompiles without execution.
Programmatic callers can use `compile(source, bindings, forms, { debug: false })`.
This emits direct calls without diagnostic wrappers, thunks, or location arguments.
Both modes use one compiler and preserve strict arithmetic and lexical scope.
Compilation errors retain source locations in either mode; runtime errors in
fast mode use native JavaScript messages. Executables are built once per compilation
and reused by `program.run()`.

## Errors

Errors appear below Run and in the browser console with a Lisp source line,
column, excerpt, and underline. Reader nodes retain source offsets. Runtime
instrumentation attributes failures to the innermost expression; calls through
Lisp functions add source call sites. Non-callable values report the original
expression and value type. Arithmetic retains its strict operand errors, and
initialization errors translate generated identifiers back to Lisp names.
Successful runs clear the previous diagnostic. This instrumentation adds runtime
overhead and can be disabled with the checkbox. There are no source maps yet; native host
function internals can still have JavaScript-specific error messages.

## Bindings

Add JavaScript functions or values to the exported object in `bindings.js`:

```js
'double-number': value => value * 2,
```

Then `(print (double-number 21))` works without changing the compiler.
`(print (greet "Shawn"))` already works. Symbols resolve to generated local
variables, allowing hyphenated names and direct function calls. Unknown symbols
fail during compilation. Binding functions receive evaluated arguments and
are called as plain functions without an object receiver.

## Arithmetic

`+`, `-`, `*`, `/`, and `%` are ordinary, first-class bindings from `arithmetic.js`.
All operands must be primitive JavaScript numbers. Strings, booleans, BigInts,
objects, null, and undefined throw TypeError; no coercion occurs.

```lisp
(print (+ 1 (* 2 3))) ; 7
(let x 10)
(set x (- x 3))
(print (/ x 2)) ; 3.5
```

`+` and `*` accept any number of operands; their empty results are 0 and 1.
`-` and `/` require at least one operand: unary forms negate and reciprocate,
respectively; additional operands apply left to right. `%` requires exactly two
operands and uses JavaScript remainder (not mathematical modulo).
Numbers retain JavaScript floating-point behavior, including Infinity and NaN
results and negative zero. `NaN`, `Infinity`, and `-Infinity` are reserved numeric
literals; `-0` preserves its sign. Overflowing ordinary literals such as `1e999`
are rejected; write `Infinity` explicitly. There is no separate integer type or type promotion.
Runtime checks apply to every call, including calls through variables.

## Interpolated strings

Prefix a string with `f` to insert values using `{expression}`:

```lisp
(let name "Shawn")
(print f"Hello, {name}!")
(print f"Total: {(+ 2 3)}")
```

Each interpolation contains exactly one Lisp expression, evaluated once from
left to right in the current lexical scope. Values use JavaScript template-string
conversion. `{{` and `}}` produce literal braces; normal JSON string escapes still
work. Plain strings do not interpolate. Statements cannot be interpolated.
These compile directly to JavaScript template literals.

## Variables

Use parentheses for declarations and assignments:

```lisp
(let message "Hello World")
(print message)
(set message (greet "Shawn"))
(print message)
```

`let` emits an actual JavaScript let statement; `set` emits assignment and returns
the assigned value. `{ ... }` creates a lexical scope and emits JavaScript braces:

```lisp
(let x 1)
{
  (let x 2)
  (print x) ; 2
}
(print x) ; 1
```

Inner declarations can shadow outer variables or host bindings. Assignment
updates the nearest variable. Duplicate declarations in one scope and variables
used outside their scope fail compilation. Access before initialization throws
a JavaScript ReferenceError, including `(let x x)` and references before a later
declaration that shadows an outer name. Form names remain reserved. Host bindings
cannot be assigned unless shadowed by a local variable. Variables reset each run.
Declarations and blocks are statements, so cannot be function arguments.

## Functions

Functions are values, defined with `fn` and a parenthesized parameter list.
Everything after the parameter list is the body, with an implicit lexical scope.
Name one with `let` and call it like any binding:

```lisp
(let say-hello (fn (name)
  (print (greet name))))
(say-hello "Shawn")

(let identity (fn (value)
  (return value)))
(print (identity 42))
```

Functions emit ordinary JavaScript functions and use explicit `return`.
`(return)` or reaching the end returns undefined. Parameters are mutable locals;
the function body shares their scope, so redeclaring a parameter is an error.
Braces inside the body create an additional nested scope and can shadow parameters.
An empty body is allowed: `(fn ())`. Closures capture live lexical variables,
and functions can call themselves or other functions after initialization.
Untyped arguments follow JavaScript rules: missing arguments are undefined, extra
arguments are evaluated and ignored. Returns are only allowed inside functions.

Run compiler checks with `node --test compiler.test.mjs`.

## Runtime type assertions

Scene functions can mix typed and untyped parameters:

```lisp
(let double (fn (value : number)
  (return (* value 2))))
(print (double 21))
(double "21") ; TypeError: Parameter value: expected number, received string "21"
```

Annotations check incoming arguments before executing the body. Untyped parameters
accept any value. Parameter annotations check incoming arguments only; later
assignments remain ordinary mutable assignments. Optional lifecycle parameters
can also be annotated, for example `(on update (dt : number) ...)`.

Use `(expression : type)` for an explicit assertion anywhere a value is needed.
It evaluates the expression once and returns the original value, without coercion:

```lisp
(let count (42 : number))
(print ("Hello" : string))
```

Runtime types are `number`, `float`, `string`, `boolean`, `function`, `vec2`, `vec3`,
`vec4`, and `texture2d`. In scene code, `float` is an alias for a JavaScript number,
including NaN and Infinity; GPU numeric parameters additionally require finite
f32-representable components. Vectors are numeric arrays or typed arrays of the
declared length. A texture2d is a runtime-issued GPU texture handle, with lifetime
and ownership validated when used in a shader call.

Arithmetic bindings share this assertion machinery. Assertions remain enabled
in fast compilation mode because they define language behavior. Shader expressions
can use colon assertions too; their types are checked at compilation rather than
per pixel. Unsupported annotations fail with Lisp source locations.

## Forms

Forms control evaluation. Add emitters to `forms.js`; each receives an array of
AST arguments, `emit(node)`, and a compiler context. Return an expression string
or `{ statement: javascript }`. The context exposes `inStatement`,
`declaration(symbolNode)`, `assign(symbolNode)`, `block(nodes)`, `statement(node)`,
`function(parameterNodes, bodyNodes)`, and `inFunction`.
An optional emitter property `declares(args)` returns a declared symbol, registering
it in its containing scope before code generation. The included
`if` emitter demonstrates `(if true (print "yes") (print "no"))`: only one branch
executes. Statement-position `if` emits JavaScript if/else with scoped branches;
expression-position `if` emits a ternary. It uses JavaScript truthiness. Form names take precedence over bindings
in call position.

Reader nodes are `{ kind: 'literal', value }`, `{ kind: 'symbol', name }`, and
`{ kind: 'list', items }`, `{ kind: 'block', items }`, and `{ kind: 'template', parts }`.
Template parts are literal strings or `{ kind: 'interpolation', expression }` nodes.
The reader supports numbers (including the special literals above), JSON-escaped strings,
booleans, parenthesized lists, brace-delimited blocks, and semicolon comments. Multiple top-level expressions run in
order; a final expression's value is returned. A final statement or empty source
returns undefined. Blocks are statements, not value-producing expressions.

The compiler has no knowledge of print or greet. Forms are trusted JavaScript extensions;
execution runs with the page's privileges, not in a sandbox.
