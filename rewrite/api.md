# Mercury JavaScript API

Mercury's JavaScript API is intended to work both inside [hg-lisp](hg-lisp.md)
and in ordinary JavaScript applications. Both consumers use the same runtime
values and type model, so embedding Mercury in a web application does not
require a separate set of data types.

This document describes the implemented app, scenes, store, core compiler,
math, JSON, and raw WGSL rendering APIs alongside the wider runtime design.
Reflection, complete shader compilation, and structured GPU data contracts
are still being specified. See the
[project overview](../README.md) for Mercury's purpose and the
[language design](hg-lisp.md) for hg-lisp forms and types.

## API conventions

Mercury separates data from functions in its JavaScript implementation and
public API. Scalar numbers use native JavaScript primitives; object data
uses plain JavaScript objects wherever possible. Functions
are grouped by their domain of operation in namespaces that are themselves
plain objects. Mercury does not define classes for its data or API namespaces.

For example, `hg.App` is a namespace object, and `hg.App.new` is an ordinary
factory function. It creates application state without a class constructor.
Operations such as `hg.App.serve(app, scene)` receive the app explicitly;
the app's data is separate from the functions that operate on it. The same
convention applies to other domains as their APIs are defined.

Functions remain first-class values in hg-lisp, including callbacks and
callable shader handles. Separating data from operations does not prohibit
holding a reference to a function. Browser-provided canvas and GPU objects
retain their native representations when used by the runtime.

### String quotes

The JavaScript codebase and code examples prefer double-quoted string
literals. hg-lisp's grammar is stricter: double quotes are its only string
delimiter. This is a language rule, not an optional formatting preference.
Raw JavaScript follows JavaScript grammar; code written for Mercury should
still follow the double-quote convention.

### Explicit operations and accessor exceptions

Property access should expose data directly. Behavior such as submitting
work, validating an edit, or synchronizing resources belongs in an explicit
function call. Mercury avoids getters and setters that hide those operations
behind a property read or assignment.

The proposed `hg.App.read` and `hg.App.write` functions follow this rule, as
do `hg.Store.get` and `hg.Store.set`: these are visible function calls, not
JavaScript property accessors. Reflection can use plain binding records and
explicit operations without requiring getters or setters on those records.

An accessor may be used where it is needed to keep the design practical.
Every Mercury-defined getter or setter must be documented alongside its
property. That documentation must identify:

- The owning data type and property.
- Why an accessor is needed.
- What reading or assigning the property does, including submission, validation,
  or other side effects.
- When those effects occur and what failures callers can observe.

Native browser properties follow their platform contracts. Using those
objects does not justify adding undocumented accessors to Mercury data.
How direct JavaScript mutations participate in validation, inspector change
tracking, and GPU synchronization remains a separate runtime contract.

## Compiler API

`hg.Compiler` is a plain namespace for source inspection and code generation.
It shares a lexer and parser between the JavaScript core backend and the WGSL
typed helper backend. Calls do not execute source, allocate GPU resources,
or install a scene. HTML and CSS remain possible future targets.

The WGSL backend targets Mercury's fragment shader functions. Only the
fragment stage is user-programmable; custom vertex and compute shaders are
unsupported. The runtime owns the non-user-programmable vertex path.

Compiler results and tokens are plain data records. The optional source
metadata record has `sourceId?: string` and `revision?: string | number`.
Hosts supply those values; the compiler echoes them so an editor can associate
results with its buffer version.

| Operation | Result |
| --- | --- |
| `Compiler.tokenize(source, options = {})` | `{ source, sourceId?, revision?, tokens, diagnostics }`. |
| `Compiler.parse(source, options = {})` | The token result plus `body`, a list of syntax nodes. |
| `Compiler.compile(source, options = {})` | `{ source, sourceId?, revision?, target, code, diagnostics, exports? }`; `target` defaults to `"js"`. WGSL helper exports map source names to generated identifiers. |

```javascript
const metadata = { sourceId: "scene.hg", revision: 7 };
const tokenResult = hg.Compiler.tokenize(source, metadata);
const syntaxResult = hg.Compiler.parse(source, metadata);
const jsResult = hg.Compiler.compile(source, { ...metadata, target: "js" });
const wgslResult = hg.Compiler.compile(helperSource, { target: "wgsl" });
```

### Tokens for the editor

Each token is `{ kind, text, start, end }`. `start` and `end` are UTF-16
offsets into the original source, with an exclusive end; they match JavaScript
string slicing. Kinds are `number`, `string`, `symbol`, `punctuation`,
`whitespace`, `comment`, `template`, and `error`. Concatenating token text
reconstructs the input exactly, including invalid characters.

Semicolons introduce line comments. Whitespace and comments remain in the
token result but do not become syntax nodes. A template occupies one token;
the parser exposes its interpolation nodes and their source ranges. Embedded
raw-source highlighting and generated-output source maps remain pending.

Lexical token kinds support syntax highlighting. Semantic classifications
of names, scopes, and types remain a separate future analysis result.

The tokenizer recognizes unsuffixed numeric literals as `num`, with `i`,
`u`, and `f` suffixes denoting `i32`, `u32`, and `f32`. `true` and `false` are
hg-lisp symbols rather than reserved boolean literals. Double quotes are
the only string delimiter, and strings use standard JavaScript escapes.
Templates use a prefix outside the quotes, as in `$"Hello {name}"`; doubled
braces represent literal braces in template text.
Highlighting and diagnostics must reflect these rules. See
[numeric literals](hg-lisp.md#numeric-literals) and
[string templates](hg-lisp.md#string-templates).

Diagnostics are `{ message, start, end }` in the same coordinate system.
Tokenization and parsing recover from unfinished strings, malformed
interpolations, and mismatched delimiters where practical. Parsing retains
partial syntax, with a nesting limit to protect editor input.

Every node has `kind`, `start`, and `end`. The syntax payloads are:

| Node kind | Payload |
| --- | --- |
| `number` | `value: number`, optional `suffix: "i" | "u" | "f"`. |
| `string` | `value: string`, decoded without evaluating source. |
| `symbol` | `name: string`; booleans remain symbols. |
| `call` | `items: Node[]`, including the operation at index zero. |
| `block` | `body: Node[]`, an explicit statement scope. |
| `member` | `object`, `key`, and `computed: boolean`. |
| `template` | `parts: (string | Node)[]`; text is decoded and expressions retain buffer spans. |

### Compilation results and execution

`code` is target source or `null` when syntax or target diagnostics prevent
compilation. Invalid API argument types raise errors; source errors return
diagnostics. A compile result does not include tokens or syntax; request those
through `tokenize` or `parse` when needed. Source maps and packaging mixed
host/shader output remain pending.

The JavaScript backend implements calls, mutable `let`, `set`, `get`, `fn`,
`return`, statement `if`/`elif`/`else`, brace scopes, literals, templates,
members, data constructors and queries, arithmetic, and comparisons.
Generated code is a strict JavaScript function body accepting the runtime
as `hg`. Hosts explicitly choose how to execute that body. Compilation alone
has no execution or scene lifecycle effects.

The WGSL backend currently emits typed helper functions, typed scalar/vector
expressions, and supported arithmetic and swizzles. It diagnoses unsupported
JavaScript data and forms. It does not generate `(sh ...)` handles or fragment
entry-point/resource interfaces. Raw fragment WGSL can instead be compiled
and submitted with [the GPU namespace](#webgpu-fragment-rendering).

WGSL modules contain named `(let name (fn ...))` definitions. Parameters
require scalar/vector annotations; return types infer from compatible return
paths. Local helpers hoist to module scope with generated names. Value
captures, function rebinding, recursion, first-class functions, and executable
module statements are diagnosed. Unsuffixed numbers require a compatible
typed operand or constructor. Only literal `xyzw` vector reads are supported;
assignments target lexical variables.

```javascript
const helpers = hg.Compiler.compile(`
(let shade (fn (uv:vec2f)
  (vec4f uv.x uv.y 0f 1f)))
`, { target: "wgsl" });

// The host checks diagnostics before composing the fragment entry point.
if (helpers.code !== null && helpers.exports?.shade) {
  const source = `${helpers.code}
@fragment fn fragment(@location(0) uv: vec2f) -> @location(0) vec4f {
  return ${helpers.exports.shade}(uv);
}`;
  const shader = await hg.GPU.shader(surface, source);
}
```

`exports` identifies public helper names for explicit host composition.
The host still supplies the fragment interface and resource declarations.

The initial JavaScript semantics are provisional: `set` produces its assigned
value; `if` uses JavaScript truthiness, creates a lexical scope per branch,
and produces no value. Bare `return` returns nil from an enclosing `fn`.
Parameter values normalize native null/undefined to nil before guards.
Calls resolve their callable before arguments; member calls retain their
native receiver. See [the implemented language subset](hg-lisp.md#implemented-compiler-subset).

hg-lisp string templates compile to native JavaScript template literals.
The emitted backticks and `${...}` belong to the target grammar; hg-lisp
source keeps its `$"...{expression}..."` notation. When that expression runs,
it immediately evaluates its interpolations and produces an ordinary string
with native JavaScript template semantics. It creates no deferred computation.
Templates are JavaScript-only and must be diagnosed in WGSL-targeted code.

The compiler must preserve hg-lisp's mutable binding semantics: `let`
introduces a scoped mutable declaration, `set` assigns to a target, and
`get` explicitly resolves a symbol when needed. hg-lisp has no constant
modifier or constant declaration form. Mutable declarations lower to valid
target declarations, such as JavaScript `let` and WGSL `var`. Compatible
constructor conversions may be erased during lowering while preserving
required conversion and failure behavior. Bindings follow JavaScript lexical
rules: a child scope may shadow a parent binding, and redeclaring `let` in
the same scope is an error. In value contexts, implicit symbols resolve
through the lexical environment; an unresolved symbol is an error. Functions
capture binding references and observe their later changes. Access before
lexical initialization follows JavaScript's error behavior. See
[core forms](hg-lisp.md#core-forms).

Operands evaluate left to right and body statements run top to bottom.
Only selected conditional bodies execute. `await` suspends its continuation;
this sequencing does not serialize otherwise independent asynchronous work.
See [evaluation](hg-lisp.md#evaluation).

Functions implicitly return the value of their final statement. An explicit
`return` exits the enclosing explicit function or current promise body or
handler early. Brace blocks introduce lexical scope in statement positions
only. They have no implicit result and establish no function-return boundary,
so a `return` inside a brace scope still targets that enclosing body. The
compiler must lower braces as scopes and preserve function results and
return boundaries within each target's constraints. On normal completion,
an empty function or one whose final statement produces no value, including
a brace scope, returns `nil`. Native JavaScript
`null` and `undefined` normalize to `nil` at the JavaScript boundary. WGSL
has no Mercury `nil` type; an unused result may lower to a function without
a return value, while typed result boundaries must satisfy WGSL constraints.
Value-omitting explicit `return` still needs a contract. See
[brace blocks](hg-lisp.md#brace-blocks).

The WGSL helper backend emits helper definitions at module scope. General
shader capture lowering, mutable captures, fragment-stage interfaces, and
generated-source mappings still need contracts. See
[function hoisting](hg-lisp.md#function-hoisting).

The proposed `async` wraps a function, `promise` supports construction and repeated
`then`/`catch`/`finally` links, and `await` waits for a promise. Inside a
promise body or `then` handler, `return` completes successfully and `reject`
completes with a rejected promise instead of throwing. Completion applies
to the current body and its resulting promise; a handler completes its own
chain stage. Any native JavaScript callbacks used by the compiler remain
implementation details. `async`, `promise`, promise chaining, `await`, and
`reject` are JavaScript-only, and the compiler must diagnose their use in
WGSL. `return` follows the language's rules for completing the enclosing
function or promise body or handler. See
[asynchronous forms](hg-lisp.md#asynchronous-forms) for the language design.

Async forms and raw `(js ...)`/`(gl ...)` embedding are currently diagnosed
as unsupported. Their execution contracts remain design work.

## Runtime entry point

Importing the runtime exposes a single plain object, `hg`, containing the
public API. `hg.App` provides the application entry point.

An application instance manages its own execution, memory, canvas, and
lifecycle. Each app manages one canvas destination and has a current scene.
App operations take the instance as their first argument.

The intended runtime will also expose instance memory and source for
inspection and live editing. An hg-lisp program can call public APIs through
`hg`; live binding reflection and automatic source installation remain
pending, as required by the self-hosted editor described below.

### `hg.App.new(options)`

Create an application instance:

```javascript
// hg is the imported runtime; myCanvas is an existing canvas.
const app = hg.App.new({
  c: myCanvas,
  w: 512,
  h: 512,
  si: 1,
  ups: 60,
});

// Queue a Scene.new(...) record, then start when ready.
```

All configuration fields are optional. The values above illustrate a
configuration rather than the defaults.

| Option | Purpose | Default |
| --- | --- | --- |
| `c` | Canvas destination: an element ID, a canvas element, or a 2D canvas context. | Unset (`nil`): the app creates its own full-screen canvas. |
| `w` | Actual width of the output graphics buffer, in pixels. | Unset (`nil`): match the destination canvas bitmap width. |
| `h` | Actual height of the output graphics buffer, in pixels. | Unset (`nil`): match the destination canvas bitmap height. |
| `si` | Uniform scale increment when presenting the output graphics on the canvas. | Unset (`nil`): no scale increment. |
| `ups` | Fixed runtime updates per second. | 60 in the host implementation. |

Mercury's `nil` merges JavaScript `null` and `undefined` into one value. At
the option boundary, omitted properties and explicit `null` or `undefined`
normalize to `nil` and use the unset defaults above. This normalization does
not preserve a distinction between the two native JavaScript values.

### Canvas resolution and sizing

An element ID identifies the canvas element to use. A canvas element can be
used directly. When `c` is a 2D context, its `canvas` property supplies the
canvas element. These inputs all resolve to the app's canvas destination.

`w` and `h` define the actual pixel dimensions of the output graphics buffer.
They describe the rendering resolution. Presentation positions and uniformly
scales that buffer to fit the destination canvas; it does not redefine the
configured buffer resolution to match the displayed size. Omitted dimensions
match the canvas bitmap dimensions.

Prefer actual pixels for presentation calculations. The destination size is
the canvas bitmap size, given by `canvas.width` and `canvas.height`, rather
than its CSS layout size. Both output buffer dimensions and destination
dimensions are already pixel counts. The policy for sizing the canvas bitmap
from CSS layout and device pixel ratio still needs to be defined.

Resolving a canvas from a 2D context does not change its context mode. A
canvas already using a 2D context cannot also supply a WebGPU context under
the [HTML canvas context rules](https://html.spec.whatwg.org/multipage/canvas.html#dom-canvas-getcontext).
`App.useGPU` therefore creates a separate internal GPU canvas and keeps
the public destination's 2D context for presentation. Each app still has
one public canvas destination.

### Frame presentation

Present the output graphics with one uniform scale for both axes, preserving
their aspect ratio. Always anchor the presented graphics at the center of
the canvas. When the scaled graphics do not fill the destination, letterbox
the unused space around them. Never squash or stretch the image to fill it.

The fit and centering geometry, in canvas bitmap pixels, is:

```text
fit = min(canvasWidth / bufferWidth, canvasHeight / bufferHeight)
presentedWidth = bufferWidth * scale
presentedHeight = bufferHeight * scale
x = (canvasWidth - presentedWidth) / 2
y = (canvasHeight - presentedHeight) / 2
```

With `si` unset, there is no scale-increment constraint. The proposed default
uses `scale = fit`, which fits the whole image while preserving its aspect
ratio. Letterboxing fills the remaining space when the aspect ratios differ.

With `si: 1`, select the largest whole-number scale that fits both destination
dimensions, with 1 as the minimum: `scale = max(1, floor(fit))`. If no positive
whole-number scale fits, keep scale 1 and clip the overflow. The graphics
remain centered in this case, so clipping is balanced around the canvas
center. Minimum-scale clipping takes precedence over shrinking the image.

For a 512-by-512 output buffer with `si: 1`:

| Canvas bitmap size | Scale | Presented size | Offset `(x, y)` | Result |
| --- | --- | --- | --- | --- |
| 1024 by 1024 | 2 | 1024 by 1024 | `(0, 0)` | Fills the destination. |
| 800 by 600 | 1 | 512 by 512 | `(144, 44)` | Centered with letterboxing on both axes. |
| 320 by 240 | 1 | 512 by 512 | `(-96, -136)` | Centered and clipped. |
| 1920 by 1080 | 2 | 1024 by 1024 | `(448, 28)` | Centered with letterboxing on both axes. |

The general rule for other increments, pixel alignment and rounding,
letterbox color or transparency, and image filtering remain open. The runtime
also needs a resize policy, including when omitted buffer dimensions follow
canvas changes. These policies must preserve the centered, uniform-scale
presentation contract.

### Implemented app foundation

`src/hg/index.ts` exports the plain `hg` namespace. The current app foundation
implements configuration, canvas presentation, events, scene lifecycle
callbacks, and app-owned snapshot storage. Apps start with a 2D output buffer
and can opt into a raw WGSL GPU surface with `App.useGPU`. The compiler is
available independently; automatic source installation and reflection remain
pending.

```javascript
import { hg } from "./src/hg";

const app = hg.App.new({ c: "preview", w: 512, h: 512, si: 1 });
const scene = hg.Scene.new({
  state: { x: 0 },
  onUpdate(state, { dt }) {
    state.x = (state.x + 60 * dt) % 512;
  },
  onRender(state, { app }) {
    // Draw into the output buffer; presentation handles the destination.
    app.graphics.fillStyle = "#161b22";
    app.graphics.fillRect(0, 0, app.buffer.width, app.buffer.height);
    app.graphics.fillStyle = "#58a6ff";
    app.graphics.fillRect(state.x, 248, 16, 16);
  },
});

hg.App.serve(app, scene);
hg.App.start(app);
```

The instance is a plain record. `app.c` and `app.context` expose the
destination canvas and its 2D context; `app.buffer` exposes the output canvas.
Initially `app.graphics` is its 2D context and `app.gpu` is null. After
`await App.useGPU(app)`, `app.graphics` is null and `app.gpu` is the surface.
Creating an app does not start its loop.
A destination that cannot provide a 2D context raises an error.

| Operation | Implemented behavior |
| --- | --- |
| `App.useGPU(app)` | Initialize a fresh WebGPU output canvas and replace the buffer after success. Return its surface asynchronously; concurrent initialization shares pending work and later calls return the active surface. Await before GPU drawing. Failures reject and preserve the existing buffer; there is no automatic fallback. |
| `App.use2D(app)` | Cancel pending GPU initialization, allocate a fresh 2D output buffer if necessary, and dispose the previous GPU surface. Return the 2D context; calling it while 2D is already active reuses that context. This synchronous backend change must be requested outside update/render callbacks. |
| `App.configure(app, options)` | Validate and copy supplied options, then queue them for the next update. Omitted fields retain their current configuration; explicit `null` or `undefined` restore their unset defaults. |
| `App.serve(app, scene)` | Validate and queue a scene replacement. At the next update, detach the old scene and attach the supplied scene; `null` detaches without a replacement. Re-serving the active object is a no-op. |
| `App.patch(app, scene)` | Validate and copy replacement callbacks now, then queue them for the next update. Keep the active scene object and its state; ignore replacement state. |
| `App.update(app, dt = 0)` | Capture queued requests, apply configuration in order, synchronize sizes, poll one deferred event batch, commit captured scene requests, and dispatch `"update"` immediately with `{ app, dt }` (`dt` in seconds). Callback requests wait for the next update. Updates during update or render callbacks are errors. |
| `App.render(app)` | Dispatch `"render"` immediately with `{ app, dt }`, drawing through callbacks without presenting. `dt` is the last update step, or zero before the first update. Rendering during update or render callbacks is an error. |
| `App.frame(app)` | Return the presentation rectangle `{ x, y, w, h, scale }` in destination bitmap pixels. |
| `App.present(app)` | Clear the destination and draw the output buffer using that rectangle. Return the rectangle. |
| `App.start(app)` | Start or resume fixed-step updates through `requestAnimationFrame`. After all updates in a browser frame, render once and present once. Repeated starts do not create extra loops. |
| `App.pause(app)` | Cancel scheduled animation and discard accumulated time, keeping the active scene attached. Manual updates, rendering, and presentation remain available. |
| `App.dispose(app)` | Pause, detach the scene once, clear events, stored data, and queued work, dispose the GPU surface if present, release the buffer bitmap, and remove an app-created destination. Cleanup completes even if `onDetach` throws. Disposal during a callback cancels remaining event delivery. Repeated disposal is harmless; other app operations except pause reject a disposed instance. |

The initial implementation chooses these provisional policies for the open
configuration and lifecycle decisions:

- `ups` defaults to 60. The loop runs at most five updates per browser frame
  and drops excess elapsed time. The first browser frame runs one update.
  Callback failures stop the loop and propagate to the caller or browser.
- `w` and `h` must be positive integer pixel dimensions that fit an unsigned
  32-bit value; the browser may impose smaller bitmap limits. `si` and `ups`
  must be positive finite numbers, and the update interval must be finite.
- An app-created canvas fills the viewport. Its bitmap follows viewport
  dimensions multiplied by device pixel ratio at each update. Caller-owned
  canvas bitmaps are left to the caller. Unset buffer dimensions follow the
  destination bitmap at each update; changing dimensions clears the buffer
  according to native canvas behavior. GPU sizes synchronize through
  `GPU.resize` and must also fit the device's texture limit.
- For any positive `si`, use the largest multiple of `si` that fits, with
  `si` as the minimum scale. This includes the documented `si: 1` behavior.
  Coordinates retain fractional pixels. Increment-constrained presentation
  disables image smoothing; unconstrained presentation enables it.
- Letterboxing is transparent. Presentation saves and restores destination
  context state, resets its transform, and neutralizes alpha, compositing,
  filters, and shadows while drawing. An existing destination clipping region
  still applies under the native canvas rules.

Configuration validation errors enqueue nothing. If an accepted destination
later fails to provide a context, that configuration leaves the current
destination and options intact, raises an error, and discards the remaining
configuration requests in that update. Earlier successful requests remain
applied.

### Events

`hg.Events` separates dispatcher state from explicit operations. Each call
to `on` creates an independent subscription; registering the same callback
twice creates two subscriptions. The dispatcher owns their `hg.ref` handles
until removal or clearing. Callers should use `Events.off` to release a
subscription, rather than releasing its handle directly.

| Operation | Behavior |
| --- | --- |
| `Events.new()` | Create an independent dispatcher. |
| `Events.on(events, when, listener, defer = true)` | Create a subscription and return its reference immediately. Registration waits for polling by default. |
| `Events.off(events, when, then, defer = true)` | Remove the subscription identified by its reference and release it. Repeated removal is harmless. |
| `Events.emit(events, when, what, defer = true)` | Dispatch a payload to listeners for that event. By default, queue the emission. |
| `Events.poll(events)` | Process one batch of queued actions in order. Actions queued by callbacks wait for the next poll; a nested poll does nothing. |
| `Events.clear(events)` | Cancel queued actions and current dispatch work, remove subscriptions, and release their references. The dispatcher can be reused. |

A listener receives `(what, context)`. The context contains `from` (the
dispatcher), `when` (the event name), and `then` (this subscription's
reference). Passing `false` as the final argument to `on`, `off`, or `emit`
performs that operation immediately. An immediate emission snapshots its
subscription order; listeners added during it wait for a later emission,
and removed listeners are skipped. Immediate nested emissions execute
within the current callback, so use the default deferred mode to avoid
recursive delivery.

```javascript
const events = hg.Events.new();
const subscription = hg.Events.on(events, "message", (message, context) => {
  console.log(message);
  // Remove this subscription at the next poll.
  hg.Events.off(context.from, context.when, context.then);
});
hg.Events.emit(events, "message", "hello");
hg.Events.poll(events); // Register the listener, then deliver "hello".
hg.Events.poll(events); // Apply the callback's removal.

// The returned handle can also be removed before its first callback.
// hg.Events.off(events, "message", subscription);
hg.Events.clear(events);
```

Callbacks are synchronous; their returned values are ignored. A callback
error propagates and discards the rest of the current poll batch, releasing
registrations that were never installed. Work newly queued by callbacks
remains available for a later poll. Clearing during polling or an emission
cancels its remaining work and releases all owned subscriptions.

### Serving scenes and live updates

The host API defines a scene as a plain bundle of state and behavior.
`hg.Scene.new({ state, onAttach?, onDetach?, onUpdate?, onRender? })` requires
an own `state` field and validates every supplied callback. It copies only
supported fields, preserving the state and callback references.
`hg.Scene.assert(scene)` performs the same validation without copying.
State may have any application-defined shape; the factory does not
deep-clone it.

Every hook receives `(state, { app, scene, dt })`. Hooks are optional and run
synchronously; the runtime does not await promises.

| Hook | Timing | `dt` |
| --- | --- | --- |
| `onAttach` | Once after the scene becomes active. | 0 |
| `onDetach` | Once when replaced, explicitly detached, or disposed. | 0 |
| `onUpdate` | On each simulation update while attached. | Step duration in seconds; fixed by `ups` in the animation loop. |
| `onRender` | Once per browser frame after its updates, or when `App.render` is called manually. | Most recent update's duration, or 0 before the first update. |

Each app has at most one active scene. `App.serve(app, scene)` validates and
queues the supplied scene object. At the next update it detaches the old
scene before attaching the replacement and uses the replacement's supplied
state reference. `App.serve(app, null)` queues a detach; serving the same
active scene object does nothing. For fresh state, construct a fresh state
value explicitly. Serving does not reset or clone an existing state value.

A scene object can be attached to only one app at a time. Use separate
`Scene.new` calls for independent apps. Sharing the same state reference
between those records is an explicit application choice.

The runtime connects update/render hooks through the app's events API and
removes those subscriptions on detach, preserving host listeners. Use
`onDetach` to release any additional resources or subscriptions created by
your hooks; use immediate `Events.off(..., false)` for removal at detachment.

`App.patch(app, replacementScene)` validates and copies replacement callbacks
when requested. At commit it replaces all four hooks, including clearing
omitted hooks, while preserving the attached scene object and its state.
The replacement's state is ignored. Patching does not invoke attach/detach
or add subscriptions; it throws at commit if no scene is attached.

Scene requests are captured at the start of an update. Configuration and
resize happen first, then one deferred event batch is polled, then captured
scene requests commit in order, and finally the update is dispatched.
Requests made in any callback wait for the next update. Manual `App.render`
does not commit requests or present the buffer; call `App.present` separately.

Submission validation failures enqueue nothing and leave the active scene
unchanged. Serving validates the supplied record again before replacement
to catch invalid direct edits while queued. That validation failure leaves
the current scene attached. If `onAttach` throws, the runtime detaches the
failed scene and releases its subscriptions; the old scene is already
detached. A failing `onDetach`
also leaves its scene detached. Errors propagate and discard remaining
captured requests, while earlier effects remain. Arbitrary state mutations
and callback side effects are not rolled back. If attachment and its cleanup
both fail, both errors are reported in an `AggregateError`.

This API accepts host scene records. hg-lisp string execution, compiler
integration, binding migration, reflection, and GPU resource ownership
remain future contracts. App-owned data can use the separate snapshot
store below to survive scene replacement.

## Reflection and external control

Mercury's intended editor is written in hg-lisp. It displays its own source,
and editing that source updates the running editor. The editor also manages
a separate application instance for the project being developed.

The editor needs to inspect and modify live values in either instance and
control the project's execution from outside that instance. Invoking
functions or API operations on the project's behalf is also under
consideration. These capabilities must be available through the runtime API
to hg-lisp programs as well as JavaScript hosts.

### Editor and project instances

The editor app owns its editor state and canvas. The project app owns its
project state and preview canvas. Each instance retains its own execution,
memory, and lifecycle. The editor holds a reference to the project instance
and names it explicitly when making runtime operations against it.

The same reflection and control interface targets the editor itself or the
project app. An hg-lisp program therefore needs a way to obtain a reference
to its own app and to hold references to other apps. The language-facing
syntax and handle representations still need to be specified.

### Inspectable memory

Inspection must expose the app's managed environment: bindings, current
values, functions, and runtime resource records. The recommended model is
a graph of references with metadata, so an inspector can represent shared
values and cycles as well as nested collections.

| Proposed metadata | Purpose |
| --- | --- |
| Owner app and lifetime | Identify the instance and whether the reference belongs to scene or app data. |
| Binding or value identity | Locate a live target across reads, writes, and compatible code updates. |
| Name and scope | Display a meaningful name and distinguish bindings with the same name in different scopes. |
| Runtime type and declared guard | Select an editor and show requirements at guarded boundaries. |
| Current value or resource description | Show live data or metadata for functions and GPU resources. |
| Source location and revision | Connect a memory entry to the code that declared it. |

Binding references should continue to identify retained bindings after a
live update. Serving a fresh scene should invalidate references to the old
scene; an inspector must not silently apply an old selection to unrelated
new scene memory. App-owned data follows its own lifetime.

Inspection of GPU resource metadata is distinct from reading GPU contents.
Host-side values can be inspected through the managed environment; fetching
GPU-produced data needs a separate completion and readback contract.
WebGPU's [buffer mapping](https://www.w3.org/TR/webgpu/#buffer-mapping) is
asynchronous, so inspection should not promise immediate access to every
GPU value.

Reflection exposure of temporary locals, captured bindings, and active call
frames still needs to be defined. The minimum reflection surface must support the
live scene values needed by the editor, without assuming that a returned
snapshot can itself modify the running app.

### Proposed reflection operations

These names and signatures illustrate the required capabilities. The object
schema, reference format, and synchronous or asynchronous results are open.

| Proposed operation | Purpose |
| --- | --- |
| `hg.App.inspect(app)` | Enumerate the managed environment and its live references. |
| `hg.App.read(app, ref)` | Read the current value or inspectable description of a reference. |
| `hg.App.write(app, ref, value)` | Apply a live edit through the runtime's mutation path. |
| `hg.App.source(app)` | Retrieve the editable hg-lisp source and revision information. |
| `hg.App.call(app, ref, args)` | Invoke a callable or exposed API operation in the target app; a candidate extension. |
| `hg.App.exec(app, script)` | Execute an injected hg-lisp command in the target environment; a candidate extension. |

```javascript
// Illustrative host-side use of the proposed reflection API.
const environment = hg.App.inspect(child);
const currentValue = hg.App.read(child, selectedBinding);
hg.App.write(child, selectedBinding, editedValue);

// Candidate external invocation and command execution.
hg.App.call(child, selectedFunction, callArgs);
hg.App.exec(child, commandSource);

// Host callback updates can already target either instance.
hg.App.patch(child, editedProjectScene);
hg.App.patch(editor, editedEditorScene);
```

Live writes use the same mutation rules as changes made within the app.
A declared guard does not automatically run on every write; a write operation
checks a guard only if its API contract establishes a guarded boundary.
Those boundaries still need to be specified. Separately, the proposed
discriminator-mutation rule requires `hg.App.write` to reject edits to an
existing object's `__type__` field; its reference schema remains open.
A write changes current runtime state. It does not automatically change the
source initializer or save data for a future scene. Writes to GPU-backed
values also need the runtime's synchronization rules.

A call made on a child's behalf must resolve its callable and app-dependent
API state in that child's environment. The target owns the execution and any
resources created there. The call contract needs argument and result rules,
completion and error reporting, and behavior when the target is paused or
has been reset. Injected code must have an explicit scope and a defined
effect on bindings; executing a command is separate from replacing the
scene's source.

External controls must include scene replacement and callback patching,
alongside the host's defined pause, start, and disposal operations. Compiled
source updates and asynchronous lifetimes remain to be specified. The
inspector also needs a refresh policy for changes caused by the app itself,
through polling or runtime notifications.

### Source and self-editing

The runtime must retain accessible hg-lisp source and connect declarations
to that source. Editing an editor source buffer then applies the preserving
scene operation to the editor app. Editing a project source buffer targets
the project app instead.

The recommended update model validates replacement code before installing
it and applies code changes at a defined execution boundary. An editor
callback can finish before its replacement becomes active. Future calls
and callbacks must reach the new code while retained bindings keep their
values. The exact boundary and binding-matching rules remain open.

Reflection is a requirement on the compiler and runtime memory model. A
possible implementation uses explicit binding records, with stable
references and source metadata, that compiled code reads and writes.
JavaScript's lexical environment records are not directly exposed to
JavaScript programs; see the ECMAScript definition of
[environment records](https://tc39.es/ecma262/multipage/executable-code-and-execution-contexts.html#sec-environment-records).
The strategy for compiling inspectable hg-lisp bindings and registering
values from raw JavaScript still needs to be chosen.

## Data that survives scenes

Scene state and information shared between scenes need different owners.
`hg.Store` provides an app-owned key-value store. A scene can
explicitly write progress, settings, or other Mercury data there, and a later
scene can read it. Resetting scene memory does not clear the store.

| Data | Lifetime | Example |
| --- | --- | --- |
| Scene memory | Patches retain the current state reference; serving another scene adopts its supplied state. | Current positions, temporary calculations, and interaction state. |
| App store | Survives live updates and new scenes within the same app. | Progress, inventory, and settings shared between scenes. |
| Saved data | Restored explicitly through a persistence backend. | A saved session or project reopened after a page reload. |

Every app starts with an empty store. Reads and writes copy data snapshots,
so edits to an input or returned value do not change the stored value.

```javascript
const progress = { level: 2, inventory: ["key"] };
hg.Store.set(app, "player/progress", progress);
progress.level = 3; // The stored snapshot still has level 2.

// A later scene reads that data from the same app.
const savedProgress = hg.Store.get(app, "player/progress");
savedProgress.inventory.push("map");
// Commit edits explicitly; subsequent reads each return another copy.
hg.Store.set(app, "player/progress", savedProgress);
```

| Operation | Behavior |
| --- | --- |
| `Store.get(app, key, fallback = null)` | Return a fresh snapshot of the stored value, or a snapshot of the fallback when the key is absent. |
| `Store.set(app, key, value)` | Validate and copy the value before replacing that key. Return no value. Failed validation leaves the previous value intact. |
| `Store.has(app, key)` | Test for an own entry, distinguishing a stored nil from a missing key. |
| `Store.delete(app, key)` | Remove an entry and return whether it existed. |
| `Store.keys(app)` | Return the current keys as a new list. Keys are literal strings; slashes do not create nested paths. |
| `Store.clear(app)` | Remove all entries while preserving the store dictionary's identity. |

Keys must be strings. The reserved dictionary key `"__type__"` cannot be
set; names such as `"__proto__"` are ordinary keys. `get` returns `unknown`
in TypeScript; use the provided type assertions to validate an expected
shape, such as `hg.num.assert(hg.Store.get(app, "score", 0))`.

Snapshots support finite numbers, strings, booleans, nil, native lists,
plain dictionaries (including null-prototype records), and validated vector
records. `undefined` normalizes to `null`. Cycles and shared values are
preserved within one snapshot; separate reads are independent. Live `ref`
handles, functions, browser objects, custom class instances, symbols,
bigints, unknown type tags, and non-finite numbers are rejected. Snapshot
copying rejects accessors and hidden properties rather than invoking
getters or losing data. Lists preserve length and empty slots; extra
non-index properties are rejected.

The store survives scene replacement and patching, and separate apps have
separate stores. The final `onDetach` callback can still read and write the
store during disposal. Cleanup then clears its dictionary and sets
`app.store` to `null`; subsequent Store operations throw. Previously returned
snapshots remain usable independently. Use Store operations for snapshot
ownership; direct edits to the managed `app.store` dictionary bypass that
boundary.

This is in-memory storage. Saving after a page reload requires an explicit
persistence backend; snapshot copying does not imply JSON serializability.
The save encoding and support for cycles remain separate contracts. See
[JSON serialization](#json-serialization) for the data encoding design.

### Key-value storage and a virtual filesystem

A key-value store gives scene-independent data named locations without
requiring scenes to manage files. A virtual filesystem fits the self-hosted
editor's source and project workflows: editable scripts, assets, directories,
and project import and export. It can be added as a separate app capability
or used as a backend for saving store data. Inspecting live memory remains a
runtime capability rather than a file-storage operation.

Either design still needs an explicit lifetime. A virtual filesystem owned
by a scene would be lost when that scene resets; an app-owned filesystem can
survive scene changes. Files alone do not establish persistence after an app
or page closes.

For browser-backed saves, [IndexedDB](https://www.w3.org/TR/IndexedDB-3/#values)
stores serializable values by key. For a file-oriented backend, the
[origin-private filesystem](https://fs.spec.whatwg.org/#api) provides files
and directories through the browser's storage API. These are possible
persistence backends, not requirements of the in-memory store.

## Application lifecycle

The host app starts paused. `App.start` runs fixed updates followed by one
render and presentation per browser frame; `App.pause` keeps its scene
attached. `App.dispose` detaches once and completes listener, store, queue, bitmap,
and owned-canvas cleanup even if the detach hook throws. Manual update,
render, and presentation are available while paused. See the implemented
operation table above for their ordering and validation.

Host `App.serve` and `App.patch` return synchronously after queuing a request;
their lifecycle effects occur at the next update. Hooks are synchronous.
GPU readiness, asynchronous external invocation, and hg-lisp execution remain
future contracts. Pending tasks also need explicit app and scene lifetimes:
the runtime must define which app's environment a
continuation resumes in and how scene resets affect its references and
writes. This matters when the editor awaits work performed by a child app.
Promise-value representation and the treatment of native JavaScript
exceptions and rejection reasons at the Mercury boundary remain open.
Promise bodies and handler functions use the implicit final-statement result
rule. An empty promise body or one ending in a statement without a value
completes successfully with `nil`; the corresponding handler function
returns `nil`.
Value-omitting explicit `return`, adoption of returned promises, `finally`
completion, and nested promise-completion and rejection scope still need
contracts.

## Consumers and execution boundaries

| Consumer | Intended relationship to the API |
| --- | --- |
| JavaScript application | Uses Mercury runtime values and operations directly, without requiring the application to be written in hg-lisp. |
| hg-lisp program | Uses the same runtime through code compiled for JavaScript. Type guards become runtime assertions on this side. |
| Shader defined with `(sh ...)` | Defines a fragment shader compiled to WGSL and produces a callable runtime handle. Its data must have an explicit WGSL-compatible shape. |

JavaScript is the host side of this design: it interacts with the browser and
holds runtime values and shader handles. WGSL is the shader side, with static
types. The API must connect these two execution environments while preserving
the meaning of values and their declared types.

The `(js ...)` and `(gl ...)` forms are escape hatches for raw JavaScript and
WGSL, respectively. Their text is emitted during compilation. Raw source
uses the same value and resource contracts as compiled hg-lisp; shader
resource binding rules still need to be defined.

## Runtime values

hg-lisp and the JavaScript API share a value model designed around JSON
compatibility. All scalar numeric types use primitive JavaScript numbers,
including `num`, `i32`, `u32`, and `f32`. Their numeric representations change
at the JavaScript/WGSL boundary rather than through boxed numeric objects
inside JavaScript. An unsuffixed numeric literal is `num`; `i`, `u`, and `f`
suffixes declare the corresponding shader-compatible scalar type.

An ordinary JavaScript object without `__type__` is a vanilla `dict`.
Other object-represented types require this exact discriminator key.
Tag values, payload fields, and recognition and validation rules remain
open, including unknown or malformed tags. Compiler or binding metadata may
track declared types for code generation and inspection; the tracking
contract remains open without requiring numeric wrappers. Type queries use
a value's suitability and shape rather than its scalar source provenance.

| Type family | Role in the runtime |
| --- | --- |
| `nil` | A JavaScript-only absence value that merges native `null` and `undefined`; encoded as JSON `null`. |
| `num`, `str` | JavaScript-only numbers and strings. |
| `bool` | Booleans supported in JavaScript and WGSL, with transfer across the JavaScript/WGSL data barrier forbidden. |
| `list`, `dict` | JavaScript-only collections; dictionaries use string keys. |
| `i32`, `u32`, `f32` | Scalars with explicit WGSL-compatible numeric types. |
| Integer and floating-point vectors | WGSL-compatible values with a fixed component count and component type. |
| Floating-point matrices | WGSL-compatible square matrices; the language currently lists 2x2, 3x3, and 4x4 types. |
| `struct`, `array` | Structured data and collections with declared WGSL-compatible shapes. |
| `texture2d`, `texture3d` | Resources representing two-dimensional and three-dimensional textures. |

The full type list and aliases are in [hg-lisp's data model](hg-lisp.md#data-model).
The distinction between JavaScript-only and WGSL-compatible types matters at
shader boundaries. The same primitive JavaScript number can be validated for
a declared numeric type, but GPU transfer needs its explicit scalar shape.
A `list` does not declare a shader-compatible array shape. Boundary packing
and resource conversion rules still need to be specified.

`bool` is usable on both execution targets, including inside shader code.
Mercury forbids passing boolean values between JavaScript and WGSL; having
the type on both sides does not make it a transferable shader input or output.

A plain JavaScript object representation is also distinct from a GPU memory
layout. Marking a type as WGSL-compatible does not specify its packing,
alignment, resource bindings, or transfer behavior.

### Implemented JavaScript data bindings

The current `src/hg/data` modules implement the bindings below. This section
describes their JavaScript behavior and core compiler bindings. General
shader-boundary contracts remain part of the intended design elsewhere in
this document.

Each type exposes a `new` constructor and a Lisp-facing
`query(a, ...b)` operation. Queries accept at most one argument, return false
for a type mismatch, and raise `TypeError` for extra arguments. Its named first
parameter preserves TypeScript type narrowing. The corresponding hg-lisp
forms are `(vec3f 1 2 3)` and `(vec3f? value)`, for example.
The public `assert(a)` helper has a fixed single-value signature: it validates
without conversion, returns the validated value, and raises `TypeError` for
a mismatch.

| Constructor | Current behavior |
| --- | --- |
| `num`, `str`, `bool`, `i32`, `u32`, `f32` | Zero arguments or a single `undefined` use the type's default; one other argument converts through the provided type descriptor; additional arguments raise `TypeError`. Numeric defaults are `0`, string default is `""`, and boolean default is `false`. |
| `nil` | Zero or one argument returns `null`; extra arguments raise `TypeError`. Its query accepts native null and undefined as nil. |
| `list` | Collects all arguments as entries. An array argument remains a nested array rather than being flattened. |
| `dict` | Converts alternating keys and values into entries. Keys use `str.new`; an unmatched final key receives `null`. Zero arguments produce an empty dictionary. A list or dictionary argument is an ordinary key input, rather than a separate copy constructor. The `"__type__"` key is reserved and rejected. |

`num.new` rejects `NaN`, `+Infinity`, and `-Infinity` after coercion;
`num.query` accepts only finite JavaScript numbers. All typed numeric
constructors share this finite-input requirement. Integer constructors
truncate toward zero and clamp finite values to their scalar ranges.
`f32.new` clamps finite values to its range while retaining ordinary host
numbers; it does not apply `Math.fround`.

String-to-number conversion trims whitespace and uses JavaScript `Number`
to parse the body. A trailing `:i`, `:u`, or `:f` selects `i32.new`, `u32.new`,
or `f32.new`; without a suffix, the result is `num`. Decimal and exponent
notation, hexadecimal, octal, and binary strings all support these suffixes,
for example `"1.5:f"`, `"1e3:i"`, `"0xff:u"`, `"0o77:i"`, and `"0b10:f"`.
Empty bodies and `NaN` parse results raise `SyntaxError`; parsed infinities
fail the constructor's finite-input check. This conversion
string syntax is separate from compiler source literals. Scalar conversions
use the supplied type descriptors: nil converts to numeric zero, boolean
false, and the string `"nil"`. `bool.new` follows each type's documented
conversion, rather than treating every object as truthy.

All nine vector types are implemented: `vec2f`, `vec3f`, `vec4f`, and their
`i` and `u` variants. Values are plain objects with a `__type__` tag such as
`"__vec3f__"` and numeric `x`, `y`, `z`, and `w` components as needed. Queries
validate the tag and every component against the corresponding scalar type.
Constructors convert components through that scalar type's constructor:

- Zero arguments produce zero components.
- Numbers supply components in order; a single number supplies the first
  component and leaves the rest zero.
- Lists, including nested lists, and vectors flatten recursively in argument
  order. Missing components fill with zero; extra components are ignored.
- Components convert through the target scalar constructor. Unsupported
  entries, including explicit null or undefined, raise errors.

```js
list.new(1, [2, 3]);                    // [1, [2, 3]]
dict.new("x", 1, "y");                 // entries x: 1, y: null
vec3f.new(1, 2, 3);                    // (vec3f 1 2 3)
vec4u.new(vec2f.new(1.9, -2), 3, 4);    // components 1, 0, 3, 4
vec3f.new(2);                         // components 2, 0, 0
vec3f.new([1, [2, 3, 4]]);            // components 1, 2, 3
```

Internal helpers use fixed parameters and double-underscore names, including
`__get__`, `__put__`, `__del__`, `__len__`, and `__coerce__`.
The same convention applies to `__str__` and `__bool__`. These names mark
private implementation functions by convention; JavaScript does not enforce
access restrictions on them.

### Collection member access

hg-lisp reads collections with dot notation. Lists use zero-based indices:
`list.0` reads the first item. `dict.name` and `dict."name"` both read the
literal string key `"name"`; the unquoted symbol is not evaluated as a variable.
Parenthesized selectors are evaluated: `list.(+ i 1)` computes an index, and
`dict.(get name)` resolves the `name` binding, whose string value supplies
the key. `set` assigns through these dot targets, for example
`(set list.0 value)` or `(set dict.name value)`. See
[collection member access](hg-lisp.md#collection-member-access).

This is hg-lisp syntax, lowered by the compiler to explicit data access over
the runtime representation without requiring custom getters. JavaScript
hosts can use JavaScript syntax or the explicit `hg.Runtime` operations:

| Operation | Behavior |
| --- | --- |
| `Runtime.get(value, key)` | Read a logical entry. Lists require an integer index from 0 through `0xfffffffe`; missing entries normalize to null. Plain records require a string key and read own properties only. Native browser objects retain their property behavior. |
| `Runtime.set(value, key, next)` | Assign and return the value, normalizing null/undefined to null. List writes may extend the list. Plain-record insertion creates an own data property, including a literal `"__proto__"` key. Nil and primitive targets are invalid. |
| `Runtime.call(value, key, args)` | Resolve the member function, then call the `args()` supplier and invoke it with `value` as its receiver. This preserves native method receivers and callable-before-arguments order. Null/undefined results normalize to null. |
| `Runtime.len(value)` | Return string/list length or the number of own dictionary keys. Typed records and native objects are invalid. |

Vector `xyzw` member reads use `Math.swizzle`. Writes to `__type__` and
writes to multiple vector components through a swizzle raise `TypeError`.
Ordinary component edits remain mutable and validate at the next guarded
boundary. These rules are the initial host collection contract; WGSL array
and struct access still need their own rules. hg-lisp's `get` and `set` forms
are separate from `hg.Store.get` and `hg.Store.set`.

### Discriminator mutation

The implemented JavaScript compiler reserves `__type__` from general mutation on existing
objects: ordinary member edits may not add, replace, or remove type metadata.
The compiler rejects writes through `set` when it can identify
that field statically, including `dict.__type__`, `dict."__type__"`, and a
computed selector whose key the compiler can determine. This reserves
representation metadata; hg-lisp declarations remain mutable.

Legitimate typed-value construction establishes a validated marker through
the constructor or typed JSON decoding. A binding can still receive a freshly
constructed value; guards run when it passes a guarded boundary. The field
remains part of the initial typed representation. Generated member assignment
uses `Runtime.set`, which also rejects that field when a computed key resolves
to it at runtime.

Runtime objects remain plain JavaScript objects. Direct JavaScript property
writes lie outside hg-lisp compiler checks, so the runtime still needs a
defined validation boundary for those writes. Rules for literal `__type__`
dictionary data depend on the unresolved collision escape. See
[reserved type metadata](hg-lisp.md#reserved-type-metadata).

### JSON serialization

`hg.Json.encode(value)` returns a JSON string after copying and validating
supported snapshot data. `hg.Json.decode(source)` parses a string and
validates the resulting data, returning a fresh value. Supported values are
finite numbers, strings, booleans, nil, lists, plain dictionaries, and validated
vector records. Null and undefined encode as null. Unknown type tags, invalid
vector components, functions, live handles, native objects, and accessor
properties are rejected.

Store snapshots preserve shared references and cycles. JSON encoding follows
JSON's tree model: repeated references are serialized as repeated values,
and cycles raise an error. Decoding creates independent tree values and does
not restore reference identity. GPU resources and execution state cannot be
saved. Matrices, structs, and typed arrays remain outside the implemented
JSON subset.

Most Mercury data types are intended to be JSON serializable, so a program
can save and restore data independently of its running application. These
types map directly to native JSON forms in both directions:

| JSON form | Mercury type |
| --- | --- |
| Number | `num` |
| String | `str` |
| Boolean | `bool` |
| `null` | `nil` |
| Array | `list` |

The `nil` type represents both native JavaScript `null` and `undefined`.
Mercury encodes `nil` as JSON `null`, and decoding that value produces `nil`.
The round trip deliberately loses the original native distinction. See
[hg-lisp's JSON serialization design](hg-lisp.md#json-serialization).

All scalar numeric types encode as native JSON numbers. For example, the
hg-lisp literal `10i` serializes as `10` and decodes as `num`; serialization
deliberately loses its `i32` type intent. `u32` and `f32` likewise do not use
tagged numeric wrappers. A native JSON array decodes as `list`.

Other serializable typed values, including vectors, matrices, structs, and
WGSL-compatible `array` values, use JSON objects with the `__type__`
discriminator, closely matching their internal representation. The implemented
vector tags and fields follow the data bindings above; other composite tags
and payload fields remain open.

Application handles and shader handles are explicitly nonserializable.
They refer to live instances and executable GPU work. Serializable
application data can be saved, but an application handle cannot be included
as a serialized snapshot.

The implemented subset rejects containers holding nonserializable handles,
functions, and GPU resource records. Supporting more composite graph shapes
still needs explicit policies. JSON serialization does not establish support
for saving live GPU contents or restoring a running application's state.

#### Dictionary encoding

Objects without `__type__` are vanilla `dict` values. Interpreting an object
as another Mercury type requires that reserved field and validation of
the corresponding payload. The presence of the field alone does not
establish that the typed object is valid.

A dictionary needing a literal `__type__` entry requires a collision policy.
An explicitly tagged dictionary escape remains a proposal. Its exact fields,
and the handling of unknown tags or malformed typed payloads, still need
to be specified.

## Shared math operations

`hg.Math` implements the initial host scalar/vector subset. Operations return
new values and do not mutate inputs. Scalars must be finite; vectors validate
their tag and components. Vector/vector operands require matching dimensions
and component types. Results validate rather than silently clamping overflow,
underflow, non-integer integer results, or non-finite arithmetic.

| Operation | Implemented operands and result |
| --- | --- |
| `Math.add(...values)` / `Math.sub(...values)` | Fold matching scalars or vectors left to right; at least two operands. `sub(value)` negates one value. |
| `Math.mul(...values)` / `Math.div(...values)` | Component-wise operations, also accepting scalar/vector scaling; at least two operands. |
| `Math.mod(a, b)` / `Math.neg(value)` | Remainder or negation over scalars and matching vector components. |
| `Math.dot(a, b)` | Dot product of matching vectors, returning a finite scalar. |
| `Math.length(value)` | Euclidean length of a vector. |
| `Math.normalize(value)` | A new floating-point vector with unit length. Integer and zero vectors are errors. |
| `Math.swizzle(value, pattern)` | Read one to four available `xyzw` components, with repetition and reordering. One component returns a scalar; more return a vector of the same component family. |
| `Math.sin(value)` / `Math.cos(value)` / `Math.sqrt(value)` | Finite scalar input and output; invalid arithmetic results raise errors. |

The JavaScript compiler lowers `+`, `-`, `*`, `/`, and `%` to these operations.
Other functions use explicit API paths, for example `(hg.Math.normalize v)`.
Writable swizzles and matrix operations are not implemented.

Arithmetic, scalar/vector/matrix operations, and vector swizzles must work
in both JavaScript and WGSL. Each supported operation needs a JavaScript
runtime implementation over Mercury data and corresponding WGSL code
generation. Both targets must preserve the operation's meaning and result
shape, including the distinction between component-wise operations and
algebraic products. Exact overloads remain to be specified.

The JavaScript interface uses ordinary namespace functions over plain typed
data. The implemented compilers lower their supported hg-lisp operations to
host calls or WGSL arithmetic; the wider matrix/overload contract remains
open. See
[arithmetic and linear algebra](hg-lisp.md#arithmetic-and-linear-algebra).

Swizzle reads select and reorder vector components, including repeated
components. Their result must have the same meaning and shape on both
targets. This fits the API's explicit-operation convention without requiring
property accessors on vector data. See
[vector swizzles](hg-lisp.md#vector-swizzles).

Writable swizzles, mutation and aliasing, scalar promotion, numeric precision,
and the WGSL feature profile still need contracts.

## Type operations

Each runtime type has a corresponding query, guard, and constructor. These
operations should carry the same type meaning whether a caller uses hg-lisp
or JavaScript. Names and signatures for the current data modules are defined
in [implemented JavaScript data bindings](#implemented-javascript-data-bindings);
those for other runtime types remain open.

| Operation | Intended purpose |
| --- | --- |
| Type query | An ordinary boolean function named `<type>?` in hg-lisp. Tests value suitability or shape; an ordinary mismatch returns false rather than asserting or throwing. |
| Type guard | Validates a value without conversion when it passes a guarded boundary. A failed runtime guard is a hard error; in WGSL the guard becomes a static type declaration. |
| Type constructor | Primitive constructors convert permissively and fail when conversion is impossible. The current collection and vector bindings are defined above; constructor contracts for other composite types remain open. |

Primitive numeric and string conversion prefers JavaScript `Number` and
`String` semantics where applicable. Numeric constructors reject non-finite
results after coercion. `i32.new` and `u32.new` truncate toward zero and clamp
finite out-of-range values. `f32.new` clamps finite out-of-range values
without applying `Math.fround`. Numeric strings additionally support the
`:i`, `:u`, and `:f` conversion suffixes described above. Native conversion
exceptions remain errors. `list.new` constructs entries from its arguments,
and `dict.new` constructs alternating key/value entries. Their variadic behavior is defined
in [implemented JavaScript data bindings](#implemented-javascript-data-bindings).

For example, `(i32? 10)` returns true because the value is suitable for
`i32`, even though its unsuffixed source literal is `num`. An `i32` parameter
guard checks the incoming primitive JavaScript number before the function
body, including validating that it is an integer. The body receives the
validated value without a numeric wrapper or coercion. The same guard
supplies a WGSL type declaration on the shader side. See
[primitive constructors](hg-lisp.md#primitive-constructors).

Guards do not continuously monitor values or automatically run on each
mutation. If a mutation makes a value unsuitable, the next guard that
receives it raises the error. Mutated data that encounters no further guard
is not automatically checked.

The current JavaScript data guards check scalar suitability and vector
components. GPU conversion, alias behavior, exact guarded API boundaries,
and error representation still need contracts. Numeric constructors and guards
reject `NaN` and infinities, but JavaScript arithmetic or direct mutation can
still introduce them. Validation of those values at serialization remains a
separate boundary contract.

The implemented vector bindings define their JavaScript component fields.
Matrix elements and their order, struct fields, and WGSL-compatible `array`
element types, lengths, and data still need contracts. Constructor inputs
and representation layouts for those types, and boundary packing for all
composite types, remain open. For object-represented types, a discriminator
alone does not define every field or component check.

## Shader handles

The `(sh ...)` form defines a fragment shader, compiles to WGSL, and emits a
handle callable like a function during runtime. The handle lets JavaScript
invoke fragment rendering defined by the shader body. It is a
nonserializable runtime reference.

Only the fragment stage is user-programmable. The runtime owns the vertex
path; custom vertex shaders and compute shaders are unsupported.

To make this usable from both consumers, the API must define typed fragment
inputs, resource bindings, the rendering destination, and output dimensions.
The handle's call signature, return values, completion behavior, and error
reporting remain open.

## WebGPU fragment rendering

`hg.GPU` implements raw WGSL fragment rendering independently of the
unimplemented `(sh ...)` handle syntax. `GPU.new(canvas)` asynchronously owns
a WebGPU device and configures a fresh canvas. It does not silently fall back
to 2D; `GPU.available()` tests browser API presence, while adapter/device
creation can still fail.

The runtime supplies a fullscreen triangle vertex stage. The fragment shader
may consume `@location(0) uv: vec2f` and must produce a compatible color output.
The initial resource layout has a four-float uniform at group 0, binding 0.
The default entry point is `fragment`. Other resource layouts, textures,
structured packing, compute stages, and custom vertex stages are unsupported.

```javascript
const surface = await hg.App.useGPU(app);
const shader = await hg.GPU.shader(surface, `
@group(0) @binding(0) var<uniform> params: vec4f;
@fragment fn fragment(@location(0) uv: vec2f) -> @location(0) vec4f {
  return vec4f(uv, params.x, 1.0);
}
`);
await hg.GPU.render(surface, shader, new Float32Array([0.5, 0, 0, 0]));
hg.App.present(app);
```

| Operation | Behavior |
| --- | --- |
| `GPU.available()` | Test for `navigator.gpu` without requesting resources. |
| `await GPU.new(canvas)` | Configure a fresh WebGPU canvas and return a plain surface record containing its native adapter, device, context, and format. A canvas already using 2D cannot be reused. |
| `await GPU.shader(surface, source, entryPoint = "fragment")` | Compile raw WGSL, reject vertex/compute stages, check compilation messages and pipeline validation, and allocate the shader's uniform. Return a shader record with native resources and compilation diagnostics. |
| `GPU.render(surface, shader, data?)` | Submit one fullscreen draw immediately. `data` must be a `Float32Array` of four finite components; the call copies it. Omitted data resets all components to zero. Return a validation promise. |
| `GPU.clear(surface, rgba = [0, 0, 0, 0])` | Submit a clear with four finite RGBA numbers and return a validation promise. |
| `GPU.resize(surface, width, height)` | Validate both bitmap dimensions before changing either; each must be an integer between zero and the device texture limit. Zero dimensions suspend drawing. |
| `GPU.release(shader)` | Release its uniform allocation and mark it disposed; repeated calls are harmless. |
| `GPU.dispose(surface)` | Release shaders, unconfigure the canvas, and destroy the owned device. Repeated disposal is harmless, including after device loss. |

Render and clear submit synchronously; their promises report validation,
not GPU completion or pixel readback. Handle rejected promises when calling
these operations from synchronous scene hooks. Shaders belong to one surface;
disposed or lost surfaces and released/foreign shaders reject further use.
Native loss information appears in `surface.lost` or `surface.lossError`.

`App.useGPU` adopts the surface for its output buffer, and `App.update`
synchronizes GPU dimensions. `app.graphics` then becomes null. The destination
remains 2D: `App.present` draws the GPU canvas with the same centered scaling
and letterboxing as a 2D buffer. `App.use2D` explicitly restores a fresh 2D
buffer and releases GPU resources. Disposal or backend cancellation while GPU
initialization awaits releases the newly created surface and rejects the
pending request. Scene detach hooks still run before app GPU cleanup.

GPU tests use API mocks for allocation, validation, submission, and cleanup.
Actual shader rendering has to be checked in a browser with WebGPU hardware
support; the test suite does not establish that hardware behavior.

## Remaining design decisions

The implemented namespaces above are callable today. The following contracts
remain for the wider runtime, compiler, and self-hosted editor:

| Area | Contract to define |
| --- | --- |
| Runtime access | Published package and import packaging; generated JavaScript currently receives `hg` explicitly. |
| API conventions | Domain namespaces, plain data shapes, explicit operations, and documented accessor exceptions. |
| Compiler API | Semantic analysis, mixed host/shader output packaging, source mappings, full WGSL captures and hoisting, fragment entry-point generation, and complete target checking. Current token/syntax/result records are defined above. |
| Application configuration | General GPU device options and resource layouts; current backend selection, bitmap sizing, and resize behavior are defined above. |
| Frame presentation | Further GPU presentation options; current GPU-canvas and 2D-buffer presentation share the documented host fit rule. |
| Scene serving and execution | Source installation and compiler binding lifetime; host scenes and raw WGSL drawing are implemented separately. |
| Preserved scene memory | Compiler binding identity, initialization, removal, guarded type changes, and GPU resource ownership; host patches preserve the existing state reference. |
| Reflection | Memory graph schema, reference identity and lifetime, source metadata, temporary locals, guarded API boundaries, and reserved-metadata validation. |
| External execution | Whether callable invocation and injected commands are provided, target scope, scheduling, result values, and errors. |
| Asynchronous execution | Promise-value representation, API completion contracts, nested promise-completion and rejection scope, value-omitting explicit return, promise adoption, finally semantics, native exceptions and rejection reasons, continuation context, and pending-task lifetimes across scene resets. |
| Self-hosted editing | Obtaining the current app, source access, code-update boundaries, and inspector refresh behavior. |
| Data shared between scenes | Save encoding, persistence backends, and serialization rules for cyclic data. |
| Value interoperability | `__type__` tag values, exact composite object fields and layout, scalar type metadata for inspection, composite constructor inputs, and native value normalization. |
| Collection access | WGSL arrays and structs, writable swizzles, and broader native-object mutation boundaries. The initial host Runtime access rules are defined above. |
| JSON encoding | Dictionary collision escape and new composite tags/payloads. Supported snapshots, finite numbers, cycles, and live-value rejection are defined above. |
| Type validation | JavaScript query and guard entry points, target constraints for non-finite numbers and numeric ranges, exact composite field shapes, alias behavior, guarded API boundaries, and error representation. |
| Shared math | Matrices, broader overloads, promotion, writable swizzles, numeric precision, and consistent target feature requirements beyond the current scalar/vector subset. |
| Mutation | Direct JavaScript write boundaries, inspector notifications, and visibility of updates to shader work; compiled metadata writes are already guarded. |
| GPU data and resources | Memory layout, resource binding, transfers, and the relationship between runtime objects and GPU resources. |
| Shader invocation | `(sh ...)` handles, typed inputs, general resource bindings, and compiler/runtime integration beyond raw WGSL's four-float uniform. |
| Runtime lifecycle | GPU readiness and device requirements, asynchronous task lifetimes, nonserializable handles, and GPU resource cleanup; host execution controls and disposal are defined above. |

As these contracts are settled, this document should add concrete signatures
and examples showing the same operation from JavaScript and hg-lisp.
