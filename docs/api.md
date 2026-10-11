# Mercury JavaScript API

Repository note: this document was supplied from another implementation as a
design reference. Its implemented-status claims and `src/hg` paths describe that
implementation. Preserve this repository's behavior except for agreed changes;
see [reference review](./REFERENCE-REVIEW.md) and [current App contract](./APP.md).

Mercury's JavaScript API is intended to work both inside [hg-lisp](./hg-lisp.md)
and in ordinary JavaScript applications. Both consumers use the same runtime
values and type model, so embedding Mercury in a web application does not
require a separate set of data types.

This document describes the intended API of the new runtime. The entry point
is defined below; other signatures and lifecycle operations are still being
specified. See the
[project overview](./README.md) for Mercury's purpose and the
[language design](./hg-lisp.md) for hg-lisp forms and types.

## API conventions

Mercury separates data from functions in its JavaScript implementation and
public API. Scalar numbers use native JavaScript primitives; object data
uses plain JavaScript objects wherever possible. Functions
are grouped by their domain of operation in namespaces that are themselves
plain objects. Mercury does not define classes for its data or API namespaces.

For example, `hg.App` is a namespace object, and `hg.App.new` is an ordinary
factory function. It creates application state without a class constructor.
Operations such as `hg.App.serve(app, script)` receive the app explicitly;
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

hg-lisp compiles to JavaScript and WGSL. The compiler must expose a public
API to both JavaScript hosts and hg-lisp programs, so the self-hosted editor
can inspect source tokens for syntax highlighting. HTML and CSS are possible
future targets; their compilation contracts have not been defined.

The WGSL backend targets Mercury's fragment shader functions. Only the
fragment stage is user-programmable; custom vertex and compute shaders are
unsupported. The runtime owns the non-user-programmable vertex path.

The proposed namespace is `hg.Compiler`, a plain object containing ordinary
functions. Compiler results and tokens are plain data records, following the
API's separation of data and operations.

| Proposed operation | Purpose |
| --- | --- |
| `hg.Compiler.tokenize(source)` | Inspect the hg-lisp source token stream for highlighting and other source tools. |
| `hg.Compiler.parse(source)` | Produce a syntax representation for source inspection and compilation. |
| `hg.Compiler.compile(source, { target })` | Generate code for a selected target, with diagnostics for that target's rules. |

```javascript
// Proposed public compiler calls; result formats remain open.
const tokenResult = hg.Compiler.tokenize(source);
const syntaxResult = hg.Compiler.parse(source);
const jsResult = hg.Compiler.compile(source, { target: "js" });
const wgslResult = hg.Compiler.compile(shaderSource, { target: "wgsl" });
```

### Tokens for the editor

The editor needs tokens from the original hg-lisp source, independently of
the emitted JavaScript or WGSL. Tokenization should be usable without a full
compilation, an application instance, or GPU initialization. A shared lexer
and parser for the targets is the recommended design, so editor tooling and
compilation agree about source syntax.

| Token metadata to define | Editor use |
| --- | --- |
| Kind | Choose highlighting for each token. |
| Text and source span | Display the source and locate the token being edited. |
| Source identity and revision | Associate tokens and diagnostics with the correct editor buffer and version. |

Exact token kinds, position units, span boundaries, and record fields remain
open. The contract also needs to say how source and revision information is
supplied. Keeping comments and whitespace available is recommended for
source display.

Lexical token kinds support syntax highlighting. Semantic classifications
of names, scopes, or types can use parser or further analysis results; those
additional contracts remain open.

The tokenizer recognizes unsuffixed numeric literals as `num`, with `i`,
`u`, and `f` suffixes denoting `i32`, `u32`, and `f32`. `true` and `false` are
hg-lisp symbols rather than reserved boolean literals. Double quotes are
the only string delimiter, and strings use standard JavaScript escapes.
Templates use a prefix outside the quotes, as in `$"Hello {name}"`; doubled
braces represent literal braces in template text.
Highlighting and diagnostics must reflect these rules. See
[numeric literals](./hg-lisp.md#numeric-literals) and
[string templates](./hg-lisp.md#string-templates).

Editing routinely produces unfinished or invalid code. The recommended
tokenization contract returns useful tokens and diagnostics for that source.
Parsing should support partial syntax where practical; malformed editor
input must not require a successful target compilation before highlighting
can update. Recovery rules and diagnostic schemas still need to be defined.

### Compilation results and execution

Compilation produces target source and diagnostics. It must apply the
selected target's constraints, including WGSL typing rules. Generated
definitions need mappings back to hg-lisp source for diagnostics and editor
inspection; the exact result fields, mapping format, and failure behavior
remain open.
A mixed host and shader program may produce multiple output artifacts;
their packaging still needs to be specified. Output ranges belong to those
artifacts, while editor token ranges belong to the analyzed source buffer.

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
[core forms](./hg-lisp.md#core-forms).

Operands evaluate left to right and body statements run top to bottom.
Only selected conditional bodies execute. `await` suspends its continuation;
this sequencing does not serialize otherwise independent asynchronous work.
See [evaluation](./hg-lisp.md#evaluation).

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
[brace blocks](./hg-lisp.md#brace-blocks).

The WGSL backend hoists actual shader-side hg-lisp function definitions into
the enclosing module code. Hoisting must preserve binding meaning, call targets,
and declared types. Generated-name collisions, target-specific lowering of
captured bindings and their mutations, WGSL legality, and generated-source
mappings still need contracts. See
[function hoisting](./hg-lisp.md#function-hoisting).

`async` wraps a function, `promise` supports construction and repeated
`then`/`catch`/`finally` links, and `await` waits for a promise. Inside a
promise body or `then` handler, `return` completes successfully and `reject`
completes with a rejected promise instead of throwing. Completion applies
to the current body and its resulting promise; a handler completes its own
chain stage. Any native JavaScript callbacks used by the compiler remain
implementation details. `async`, `promise`, promise chaining, `await`, and
`reject` are JavaScript-only, and the compiler must diagnose their use in
WGSL. `return` follows the language's rules for completing the enclosing
function or promise body or handler. See
[asynchronous forms](./hg-lisp.md#asynchronous-forms) for the language design.

Compiler calls inspect or transform source without applying it to a running
app. Serving a scene, updating code, registering runtime callbacks, and
executing GPU work remain explicit runtime operations. Calling the compiler
does not itself change application memory or install the generated code.

## Runtime entry point

Importing the runtime exposes a single plain object, `hg`, containing the
public API. `hg.App` provides the application entry point.

An application instance manages its own execution, memory, canvas, and
lifecycle. Each app manages one canvas destination and has a current scene.
App operations take the instance as their first argument.

The runtime also exposes instance memory and source for inspection and live
editing. An hg-lisp program can manage another app through the same public
API, as required by the self-hosted editor described below.

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

hg.App.serve(app, "...");
```

All configuration fields are optional. The values above illustrate a
configuration rather than the defaults.

| Option | Purpose | Default |
| --- | --- | --- |
| `c` | Canvas destination: an element ID, a canvas element, or a 2D canvas context. | Unset (`nil`): the app creates its own full-screen canvas. |
| `w` | Actual width of the output graphics buffer, in pixels. | Unset (`nil`): match the destination canvas bitmap width. |
| `h` | Actual height of the output graphics buffer, in pixels. | Unset (`nil`): match the destination canvas bitmap height. |
| `si` | Uniform scale increment when presenting the output graphics on the canvas. | Unset (`nil`): no scale increment. |
| `ups` | Runtime updates per second. | Not yet specified. |

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
The rendering contract therefore needs to explain how GPU output reaches
that destination, including whether the app uses a separate internal GPU
surface. This is distinct from supporting only one public canvas per app.

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
implements configuration, a 2D output buffer, canvas presentation, and an
update loop. GPU rendering, compiler integration, `serve`, `patch`, and
reflection are still pending. The 2D buffer is an initial host rendering
path; it does not define the future shader-output contract.

```javascript
import { hg } from "./src/hg";

const app = hg.App.new({ c: "preview", w: 512, h: 512, si: 1 });

hg.Events.on(app.events, "update", ({ app, dt }) => {
  // dt is in seconds. Draw into the output buffer, not the destination.
  app.graphics.fillStyle = "#161b22";
  app.graphics.fillRect(0, 0, app.buffer.width, app.buffer.height);
});

hg.App.start(app);
```

The instance is a plain record. `app.c` and `app.context` expose the
destination canvas and its 2D context; `app.buffer` and `app.graphics` expose
the output canvas and its 2D context. Creating an app does not start its loop.
A destination that cannot provide a 2D context raises an error.

| Operation | Implemented behavior |
| --- | --- |
| `App.configure(app, options)` | Validate and copy supplied options, then queue them for the next update. Omitted fields retain their current configuration; explicit `null` or `undefined` restore their unset defaults. |
| `App.update(app, dt = 0)` | Apply queued configuration in order, synchronize canvas and buffer sizes, and emit `"update"` with `{ app, dt }`. A handler's configuration changes wait until the next update. Recursive updates are errors. |
| `App.frame(app)` | Return the presentation rectangle `{ x, y, w, h, scale }` in destination bitmap pixels. |
| `App.present(app)` | Clear the destination and draw the output buffer using that rectangle. Return the rectangle. |
| `App.start(app)` | Start or resume fixed-step updates through `requestAnimationFrame`, presenting after the updates in each browser frame. Repeated starts do not create extra loops. |
| `App.pause(app)` | Cancel scheduled animation and discard accumulated time. Manual updates and presentation remain available. |
| `App.dispose(app)` | Pause, clear subscriptions and queued configuration, release the buffer bitmap, and remove an app-created destination. Repeated disposal is harmless; other app operations except pause reject a disposed instance. |

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
  according to native canvas behavior.
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

`hg.Events.new()` creates an independent dispatcher. `on(events, name,
handler)` registers a callback once and returns it; `off(events, name,
handler)` removes it. `emit(events, name, value)` synchronously dispatches
the value. Each emission snapshots its handlers in registration order.
Subscription changes affect later emissions, and nested emissions queue
behind the current one. A callback error propagates, discards pending
emissions, and leaves the dispatcher ready for a later call.

### Serving scenes and live updates

A live environment needs two separate operations: one that replaces scene
code while preserving scene memory, and one that starts a scene with fresh
memory. Both operate on the existing application instance.

The scene entry point is `hg.App.serve`. The proposed division starts it with
fresh scene memory and adds `hg.App.patch` for updates that preserve the
current scene's memory.

| Proposed operation | Scene code | Scene memory | Application instance |
| --- | --- | --- | --- |
| `hg.App.serve(app, script)` | Serve the script as the current scene. | Reset and initialize fresh scene state. | Keep the existing app. |
| `hg.App.patch(app, script)` | Replace the current scene's code for live editing. | Preserve existing scene state. | Keep the existing app. |

```javascript
// Proposed division of the two operations.
hg.App.serve(app, initialScript); // Start with fresh scene memory.
hg.App.patch(app, editedScript); // Change code while retaining scene memory.
hg.App.serve(app, nextScript);    // Start another scene with fresh memory.
```

Preserving memory must be more precise than evaluating a script again. A
live update needs rules for identifying existing bindings, initializing new
ones, handling removed bindings, and changes to guarded types. It also needs
to replace obsolete callbacks and other scene behavior without accumulating
duplicate execution. These rules remain open.
JavaScript lexical binding rules alone do not define which binding identities
survive a code update.

Resetting scene memory should leave data intentionally owned by the app
available to the next scene. The proposed store below provides that separate
lifetime.

The script argument's format, return values, completion behavior, GPU
resource ownership, and failed-update behavior still need to be defined. A
recommended failure rule is to validate the replacement before committing
it, leaving the current code and state in place if validation fails. This
does not imply automatic rollback of arbitrary JavaScript side effects.

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

// The same code-update operation can target either instance.
hg.App.patch(child, editedProjectSource);
hg.App.patch(editor, editedEditorSource);
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

External controls must include the two scene operations for preserving and
resetting memory. Pause, resume, and other lifecycle operations remain to be
specified. The inspector also needs a refresh policy for changes caused by
the app itself, through polling or runtime notifications.

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

## Data that survives scenes (proposal)

Scene state and information shared between scenes need different owners.
The recommended design is a small app-owned key-value store. A scene can
explicitly write progress, settings, or other Mercury data there, and a later
scene can read it. Resetting scene memory does not clear the store.

| Data | Lifetime | Example |
| --- | --- | --- |
| Scene memory | Preserved by live updates; reset when serving a fresh scene. | Current positions, temporary calculations, and interaction state. |
| App store | Survives live updates and new scenes within the same app. | Progress, inventory, and settings shared between scenes. |
| Saved data | Restored explicitly through a persistence backend. | A saved session or project reopened after a page reload. |

The following API names are illustrative:

```javascript
// Current scene writes data that should survive its replacement.
hg.Store.set(app, "player/progress", progress);

// A later scene reads that data from the same app.
const savedProgress = hg.Store.get(app, "player/progress");
```

The store belongs to the app rather than the imported `hg` object. Separate
application instances therefore have separate stores unless sharing is
explicitly configured. Disposing an app ends its in-memory store's lifetime;
retaining that data after a page reload requires an explicit save mechanism.

The store should own its values independently from scene execution. Its
contract still needs to choose between shared mutable values and copied
snapshots, and define missing keys, deletion, and accepted value types.
Most Mercury data types are intended to support JSON serialization for
explicit saves. Application and shader handles are nonserializable runtime
references. Rules for saving collections that contain handles, functions,
cycles, or GPU resources remain open; storing a live reference in memory
does not establish that it can be saved. See [JSON serialization](#json-serialization)
for the data encoding contract.

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
persistence backends, not requirements of the in-memory store proposal.

## Application lifecycle

The app manages execution and memory across its lifecycle. `new` creates
the instance; the two scene operations provide fresh scenes and live code
updates. The public contracts for readiness, starting execution, pausing,
and releasing resources remain open. The example's immediate call to `serve`
also needs a rule for any GPU initialization that is still pending.

hg-lisp's asynchronous forms do not determine whether `hg.App.serve`, the
proposed `hg.App.patch`, or external invocation operations return promises.
Those completion contracts remain open. Pending tasks also need explicit
app and scene lifetimes: the runtime must define which app's environment a
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

The full type list and aliases are in [hg-lisp's data model](./hg-lisp.md#data-model).
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
describes their JavaScript behavior; compiler integration and shader-boundary
contracts remain part of the intended design elsewhere in this document.

Each type exposes a variadic `new(...a)` constructor and a Lisp-facing
`maybe(a, ...b)` query. A query requires exactly one argument, returns false
for a type mismatch, and raises `TypeError` for invalid arity. Its named first
parameter preserves TypeScript type narrowing. The corresponding hg-lisp
forms are `(vec3f 1 2 3)` and `(vec3f? value)`, for example.
The public `assert(a)` helper has a fixed single-value signature: it validates
without conversion, returns the validated value, and raises `TypeError` for
a mismatch.

| Constructor | Current behavior |
| --- | --- |
| `num`, `str`, `bool`, `i32`, `u32`, `f32` | Zero arguments or a single `undefined` produce `0`, `""`, or `false` as appropriate; one other argument converts it; additional arguments raise `TypeError`. |
| `nil` | Returns `null` regardless of its arguments. |
| `list` | Collects all arguments as entries. An array argument remains a nested array rather than being flattened. |
| `dict` | Converts alternating keys and values into entries. Keys use `str.new`; an unmatched final key receives `null`. A single dictionary is returned unchanged; a single list supplies alternating keys and values. Zero arguments, or a single `null` or `undefined`, produce an empty dictionary. The `"__type__"` key is reserved and rejected. |

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
string syntax is separate from the intended compiler source literal grammar.
`bool.new` uses JavaScript boolean conversion.

All nine vector types are implemented: `vec2f`, `vec3f`, `vec4f`, and their
`i` and `u` variants. Values are plain objects with a `__type__` tag such as
`"__vec3f__"` and numeric `x`, `y`, `z`, and `w` components as needed. Queries
validate the tag and every component against the corresponding scalar type.
Constructors convert components through that scalar type's constructor:

- Zero arguments, or a single `null` or `undefined`, produce zero components.
- A single number fills every component with that value.
- A single list supplies the first required components, all of which must be
  numbers; extra entries are ignored and missing components are errors.
- A single vector is copied, trimming larger dimensions or filling smaller
  dimensions with zeros. Its declared dimension determines its components.
- Multiple arguments flatten numbers, lists of numbers, and vectors in order.
  They must supply exactly the target component count; nested lists and
  unsupported values are errors.

```js
list.new(1, [2, 3]);                    // [1, [2, 3]]
dict.new("x", 1, "y");                 // entries x: 1, y: null
vec3f.new(1, 2, 3);                    // (vec3f 1 2 3)
vec4u.new(vec2f.new(1.9, -2), 3, 4);    // components 1, 0, 3, 4
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
[collection member access](./hg-lisp.md#collection-member-access).

This is hg-lisp syntax, lowered by the compiler to explicit data access over
the runtime representation without requiring custom getters. JavaScript
hosts use JavaScript syntax. `list` and `dict` remain JavaScript-only; WGSL
array and struct access need separate rules. Missing keys, insertion,
out-of-range indices, numeric coercion, and mutation validation remain open
contracts. hg-lisp's `get` and `set` forms are separate from the explicit
JavaScript API functions `hg.Store.get` and `hg.Store.set`.

### Discriminator mutation (proposal)

The recommended rule reserves `__type__` from general mutation on existing
objects: ordinary member edits may not add, replace, or remove type metadata.
The compiler should reject writes through `set` when it can identify
that field statically, including `dict.__type__`, `dict."__type__"`, and a
computed selector whose key the compiler can determine. This reserves
representation metadata; hg-lisp declarations remain mutable.

Legitimate typed-value construction establishes a validated marker through
the constructor or typed JSON decoding. A binding can still receive a freshly
constructed value; guards run when it passes a guarded boundary. The field
remains part of the initial typed representation. Enforcing the same rule
for keys determined at runtime would require validation in compiled
assignment and mutation API paths; that
policy and its errors still need to be specified.

Runtime objects remain plain JavaScript objects. Direct JavaScript property
writes lie outside hg-lisp compiler checks, so the runtime still needs a
defined validation boundary for those writes. Rules for literal `__type__`
dictionary data depend on the unresolved collision escape. See
[reserved type metadata](./hg-lisp.md#reserved-type-metadata).

### JSON serialization

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
[hg-lisp's JSON serialization design](./hg-lisp.md#json-serialization).

All scalar numeric types encode as native JSON numbers. For example, the
hg-lisp literal `10i` serializes as `10` and decodes as `num`; serialization
deliberately loses its `i32` type intent. `u32` and `f32` likewise do not use
tagged numeric wrappers. A native JSON array decodes as `list`.

Other serializable typed values, including vectors, matrices, structs, and
WGSL-compatible `array` values, use JSON objects with the `__type__`
discriminator, closely matching their internal representation. Exact tag
values and payload fields, along with serializer names and signatures,
remain open.

Application handles and shader handles are explicitly nonserializable.
They refer to live instances and executable GPU work. Serializable
application data can be saved, but an application handle cannot be included
as a serialized snapshot.

Whole-graph rules also remain open: shared references, cycles, containers
holding nonserializable handles, functions, and GPU resource records need
explicit policies. JSON serialization does not establish support for saving
live GPU contents or restoring a running application's execution state.

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

Arithmetic, scalar/vector/matrix operations, and vector swizzles must work
in both JavaScript and WGSL. Each supported operation needs a JavaScript
runtime implementation over Mercury data and corresponding WGSL code
generation. Both targets must preserve the operation's meaning and result
shape, including the distinction between component-wise operations and
algebraic products. Exact overloads remain to be specified.

The proposed JavaScript interface uses ordinary namespace functions over
plain typed data. The compiler can lower hg-lisp math to those calls and
emit the corresponding WGSL operations. JavaScript callers invoke these
functions explicitly; public names and hg-lisp notation remain open. See
[arithmetic and linear algebra](./hg-lisp.md#arithmetic-and-linear-algebra).

Swizzle reads select and reorder vector components, including repeated
components. Their result must have the same meaning and shape on both
targets. This fits the API's explicit-operation convention without requiring
property accessors on vector data. See
[vector swizzles](./hg-lisp.md#vector-swizzles).

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
[primitive constructors](./hg-lisp.md#primitive-constructors).

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

## Decisions needed for an executable API

The shared value model and the JavaScript/WGSL split establish the direction
of the API. The following decisions are needed before this page can become
a callable reference:

| Area | Contract to define |
| --- | --- |
| Runtime access | Import packaging for the `hg` object and access from compiled hg-lisp. |
| API conventions | Domain namespaces, plain data shapes, explicit operations, and documented accessor exceptions. |
| Compiler API | Final tokenize/parse/compile signatures, token and syntax schemas, source revisions, error recovery, template nesting and malformed interpolation diagnostics, fragment-target diagnostics, WGSL capture lowering and hoisting, value-omitting explicit return, target result constraints, compilation results, and source mappings. |
| Application configuration | Default `ups`, validation after `nil` normalization, canvas bitmap sizing, and resize behavior. |
| Frame presentation | Confirmation of the unconstrained fit rule, other scale increments, pixel alignment, letterbox appearance, and filtering. |
| Scene serving and execution | Contracts for serving fresh scenes and live updating, the proposed `patch` name, script format, compilation, execution timing, and failure reporting. |
| Preserved scene memory | Binding identity, initialization, removal, guarded type changes, callbacks, and resource ownership during live updates. |
| Reflection | Memory graph schema, reference identity and lifetime, source metadata, temporary locals, guarded API boundaries, and reserved-metadata validation. |
| External execution | Whether callable invocation and injected commands are provided, target scope, scheduling, result values, and errors. |
| Asynchronous execution | Promise-value representation, API completion contracts, nested promise-completion and rejection scope, value-omitting explicit return, promise adoption, finally semantics, native exceptions and rejection reasons, continuation context, and pending-task lifetimes across scene resets. |
| Self-hosted editing | Obtaining the current app, source access, code-update boundaries, and inspector refresh behavior. |
| Data shared between scenes | Acceptance of the app-store proposal, value ownership, get/set semantics, and persistence of serializable data. |
| Value interoperability | `__type__` tag values, exact composite object fields and layout, scalar type metadata for inspection, composite constructor inputs, and native value normalization. |
| Collection access | Index validation and coercion, missing keys, insertion and out-of-range writes, reserved-marker validation, and access and write rules for WGSL arrays, structs, and swizzles. |
| JSON encoding | Dictionary collision escape, exact tag values and payload fields, non-finite numeric encoding, serializer API, and policies for graphs containing cycles, shared references, nonserializable handles, functions, or GPU resources. |
| Type validation | JavaScript query and guard entry points, target constraints for non-finite numbers and numeric ranges, exact composite field shapes, alias behavior, guarded API boundaries, and error representation. |
| Shared math | Public operation names, hg-lisp notation, scalar/vector/matrix overloads, result types, swizzle reads and writes, mutation, promotion, precision, and target feature requirements. |
| Mutation | Adoption of the reserved `__type__` mutation rule, compile-time rejection for known keys, runtime checks for computed keys, the direct JavaScript write boundary, and visibility of updates to shader work. |
| GPU data and resources | Memory layout, resource binding, transfers, and the relationship between runtime objects and GPU resources. |
| Shader invocation | Fragment inputs, resource bindings, rendering destination, output dimensions, handle arguments and results, completion, and error behavior. |
| Runtime lifecycle | Readiness, browser/device requirements, execution controls, lifetimes of nonserializable handles, and cleanup of app-owned memory and resources. |

As these contracts are settled, this document should add concrete signatures
and examples showing the same operation from JavaScript and hg-lisp.
