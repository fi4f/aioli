# Mercury architecture

Mercury (`hg`) compiles Lisp to JavaScript and WGSL. `STYLE.md` defines the
implementation style: ordinary mutable records hold state, namespace functions
hold behavior, and operations receive their target record as the first argument.
Private implementation names use both a double-underscore prefix and suffix,
such as `__name__`. Functions work without a `this` receiver.
Selected Lisp forms may imply the app that owns their compiled code; namespace
operations remain explicit, with no global current-app state.

All engine modules live directly in `hg/`. Modules normally export one domain
namespace. `app.js` exports `App` and the internal `AppCore` orchestration namespace.
`hg/tools/` contains code generators and profiling scripts; `hg/tests/` contains tests.
`docs/` contains all documentation and supplied Markdown references. `examples/`
contains Lisp examples and additional JavaScript/HTML hosts; `editor/` contains
the editor's `index.html`, `index.js`, and Lisp files. The repository root retains
`index.html` and `index.js` as the staging entry points.

## Module composition and Lisp exposure

Value construction, conversion, queries/guards, storage access, and GPU packing
are distinct responsibilities. `NumericTypes` owns numeric rules; `Data` and
`Structures` own values and explicit views; `Conversions` constructs scalar
values; dictionary constructors validate already evaluated string keys without
conversion. `Types` validates
boundaries; generated `TypeBindings` and `Bindings`
assemble language names. Compiler lowering consumes those rules, and App owns
execution and browser resources. Importing a type must not select an app or
populate a mutable process-wide type registry.

The reviewed reference samples suggested per-type namespaces with `new`,
query, and assertion functions. The samples have been removed; their useful
details remain in [the review](./REFERENCE-REVIEW.md). Such namespaces can compose
these responsibilities and later be shared directly by JS and Lisp. Lists use native JS arrays and
dictionaries use plain untyped objects, preserving identity across JS/Lisp calls.
Standalone vectors use `__type__` and named component fields. Shared packed vectors
and matrix columns use explicit views; component snapshots do not mutate storage.
Additional per-type namespaces and their exposure remain proposals. The
documents describe another implementation; its implemented-status claims do not
describe this engine. See [reference comparison](./REFERENCE-REVIEW.md)
for concrete differences and the agreed numeric clamping, native collection/JSON,
finite-number, vector representation/construction, dictionary construction,
defaults, numeric parsing/suffix changes, JS string escapes and dollar templates,
computed dot access, explicit binding/path lookup, and implicit final-value returns.

Boolean values cannot cross the host/GPU boundary, including nested struct fields
and array/many elements. `Structures.isHostShareable` recursively checks layouts;
shader compilation, graphics input validation, and GPU packing enforce the rule.
Host boolean collections retain their host representation. Shader-local structures
and helper parameters/results use native WGSL booleans without numeric encoding.

`Types.type(value)` implements host Lisp type introspection. The compiler's `type`
form evaluates its argument once and returns a dunder string. All scalar numbers
report `"__num__"`; collection and typed-value identities use existing runtime
classification, without interpreting arbitrary dictionary tags.

Shader helpers remain static functions lifted to WGSL module scope. Capture analysis
uses lexical binding identities and tracks writes through nested helper calls and
lazy selectors. Hidden capture arguments pass current values by copy for reads,
or `ptr<function, T>` for possible writes. Captured fields/components share one
pointer to their containing variable. This preserves live mutations without
introducing WGSL function values or mutable module globals.

## Current modules

| Modules | Namespace and responsibility |
| --- | --- |
| `app.js` | `App`: creation, serve/patch, reflection, calls, exec, pause/start, tokenization, disposal. `AppCore`: host orchestration and activation. |
| `scheduler.js` | `Scheduler`: per-instance clocks, named hooks, frame scheduling, and injected frame preparation. |
| `modules.js` | `Modules`: loader records, URL resolution, owned caches, cycle checks, live binding cells. |
| `scene-memory.js` | `SceneMemory`: top-level scene cells, retained-value lookup, import scopes, internal source origins, binding reflection and reference lifetimes. |
| `events.js` | `Events`: independent generic dispatchers, ordered subscriber snapshots, and queued nested emissions. Scene `on` declarations remain named runtime hooks. |
| `compiler.js`, `forms.js`, `conditionals.js`, `codegen.js` | `Compiler`, `Forms`, `Conditionals`, `Codegen`: reading and JavaScript emission. Separate `Compiler.compile`, `compileScene`, `compileModule`, and `compileExec` entry points; `run` executes a program record and `runExec` executes against live scene memory. |
| `shader.js`, `tokenize.js` | `Shader`: WGSL emission and compilation-local layouts. `Tokenizer`: explicit incremental lexer records and deferred spans. |
| `data.js`, `structures.js`, `types.js` | `Data`, `Structures`, `Types`: language values, explicit storage access, packed layouts, validation, dot operations. |
| `numeric-types.js`, `numeric.js`, `arithmetic.js`, `math.js`, `conversions.js`, `colors.js`, `transforms.js` | Numeric metadata, type rules, arithmetic, math, conversion, color, transform namespaces. |
| `text.js`, `promises.js`, `errors.js`, `loops.js`, `trace.js` | Text construction/rasterization, async operations, serializable error records, iteration, explicit trace records. |
| `graphics.js`, `inner-canvas.js` | `Graphics`, `InnerCanvas`: per-instance GPU resources, rendering, defensive 2D presentation. |
| `input.js`, `text-proxy.js` | `Input`, `TextProxy`: per-instance browser input records and invisible native editing. |
| `bindings.js`, `contracts.js` | `Bindings`, `Contracts`: language exposure and shared execution vocabulary. |
| `*.generated.js` | Static arithmetic, swizzle, constructor, and guard families emitted by scripts in `hg/tools/`. |

App data owns its scheduler, loader, lexer, input, presentation, GPU resources,
and text proxies. Browser services return records without instance methods.
`Graphics.render(graphics, callback)` and `InnerCanvas.paint(display)` operate on
explicit records. Internal `app.services` namespaces supply replaceable service
implementations; orchestration reads their current functions at each operation.
Browser listeners and Lisp callable bindings adapt callbacks to owned records.
App supplies the scheduler's preparation callback explicitly; Scheduler does not
import app orchestration. Module execution uses the owning loader and app services
without substituting `app.source` or `app.sourceURL`. Scene memory retains each
compiled scene's effective source origin for relative imports and later injections.
Scene initialization still temporarily exposes candidate source to its own code,
as required by the self-editor. Omitted replacement origins use the committed
scene's origin rather than a temporarily initializing program's origin.

`hg/hg.js` exposes `App`, `Events`, and `TextProxy`; Lisp receives those same namespaces.
`App.new` returns synchronously; `App.serve(app, source)` and `App.patch(app, source)`
await initialization. Serving initializes fresh scene bindings; patching matches
top-level data by name, skips retained initializers, and rebuilds code definitions.
Both produce new binding cells and closures; retained data keeps its identity.
Private weak metadata associates scenes with their cells. Modules keep their
separate app-owned cache. Explicit retained-value annotations use the normal type
guards. An incompatible previous value causes that binding's new initializer to
run; its result must pass the same guard before entering the candidate scene.
Resource cleanup remains with each resource's owner. Removing or reinitializing
a binding does not dispose resources, transfer ownership, or extend borrowed
lifetimes; patching does not scan the app's references to infer disposal.
Each app starts with its own plain `state` dictionary for explicitly shared data.
JS and Lisp read and mutate the same values; `serve` and `patch` preserve this
dictionary. Saving remains explicit, and no separate `Store` namespace is added.
`App.inspect` enumerates the committed scene's top-level bindings as a plain
dictionary of registered `__binding__` handles. `App.read` observes current cell
values; `App.write` validates language-value admission and binding mutability,
without repeating initializer assertions. Compiler-created cells keep mutability
in weak metadata. Each app owns its reflection state; commit updates surviving
references only after scene replacement succeeds. Removed references release their
cell targets permanently; fresh serving and disposal invalidate all old references.
`App.call` resolves a live binding through the same owner/lifetime checks and
invokes its function with a native list of arguments. Calls use the function's
lexical environment and normal guards, execute immediately without scheduling,
and preserve return values and promise identity. Ordinary calls to function values
returned by `App.read` remain available.
`App.exec` compiles an injection against the committed scene's existing cells and
struct definitions. New top-level cells enter that scene and its reflection as
their declarations execute. Scene memory retains top-level import scopes for later
injections. Callback declarations update the active scene; execution uses the app's
existing services without changing its stored source or restarting scheduling.
Pending injections check scene lifetime before further top-level statements.
`App.pause` and `App.start` control the app-owned scheduler without replacing its
scene. The scheduler keeps explicit pause through replacement, discards queued
renders and accumulated backlog on pause, and resets the wall-time baseline on
resume. Scheduling guards prevent duplicate loops and paused event-driven renders.
Separate attachment and frame generations allow async attach completion while
paused and suppress callbacks belonging to superseded scene transitions.
`(text-proxy callback)` creates an app-owned editing record, followed by calls
such as `(TextProxy.sync proxy source anchor head)`. Other namespaces remain
internal until their Lisp contracts are designed. Exposure never selects an app.

Compiled programs contain data and a generated executable, without a `run` method.
Module namespaces are plain objects holding ordinary `{ value }` cells shared
with lexical closures and imports. Private weak metadata identifies these
namespaces without reserving dictionary keys. Numeric/struct views explicitly
refer to their owner's packed storage.
`Data.get`, `Data.put`, and `Data.values` perform storage access. Deferred lists
use sparse arrays: `Data.get` builds a requested entry; `Data.values` materializes
the list. Property reads invoke no engine getters, setters, or Proxies.
Lisp `get` is explicit binding/path lookup; dot paths perform collection access.
Computed dot selectors use checked index/key operations and also support assignment.
See [storage access](./ACCESSORS.md).

Browser boundaries still require native canvases, GPU resources, promises, typed
buffers, listeners, and executables. These are not JSON data. Weak language
identity/capability registries also support caller-frozen opaque handles; they
hold no app execution state. Array/many layout descriptors have no process-wide
cache. Shader layout identities are local to each compilation and compare
compatible layouts structurally.

Runtime-created texture handles are plain records with `__type__: '__texture2d__'`.
The GPU resource stays in the owning graphics service's weak metadata. Lisp exposes
the handle's type through `type`, `texture2d?`, and read-only `__type__` access;
registered identity determines its type and shader ownership checks determine
whether it can be used. A dictionary with the same marker remains a dictionary.
JSON cannot serialize or restore resource handles. Existing registered caller-frozen
handles need no mutation; Lisp reads their marker through explicit access.

Caller-supplied canvases remain externally owned. Omitting `c` creates an owned
`100dvw` by `100dvh` surface. Each app renders on its own WebGPU canvas and presents
into the outer 2D canvas. Disposal releases owned resources and removes owned DOM
surfaces. Traced reloads retain the working scene through candidate initialization,
attach, and first rendering.

Supplied outer bitmap dimensions are read without resizing them. App selects an
explicit `InnerCanvas.bitmapSize` policy for supplied canvases and
`InnerCanvas.displaySize` for runtime-created canvases. The latter uses rounded
CSS bounds multiplied by device pixel ratio. Automatic inner axes follow the
destination bitmap; host input and caret positioning already map CSS coordinates
to and from bitmap pixels. The editor host explicitly manages its supplied canvas
bitmap in CSS pixels to retain its existing editor layout.

Presentation clears unused outer pixels, leaving their appearance to the canvas
or its parent. Runtime-created canvases receive a black CSS background; supplied
canvases keep their existing styling and can have transparent borders.
Boolean `app.is` controls presentation smoothing independently of `app.si` and
defaults to false. Creation and Lisp `configure` use the same setting. An explicit
configuration callback mirrors requested display options into app data; frame
preparation validates direct app-field edits. The display tracks its last
presented smoothing setting so a change redraws the existing image.

`index.html` loads the vanilla staging host from `index.js`;
`editor/index.html` loads Mayo's canvas editor from `editor/index.js`.
Embedded children, program exports, structured diagnostics, and redesigning native
text editing remain deferred. JavaScript is the CPU target; no Wasm backend or
legacy Aioli facade is provided.

See [App contract](./APP.md), [rewrite objectives](./OBJECTIVES.md),
and [design discussion](./API-DESIGN.md).

Promise construction uses `promise`; `async` wraps functions. The compiler owns stage
boundaries for explicit `resolve`/`reject` exits, while normal function returns and
completion remain supported. Nested functions capture the nearest stage settlement
record; native first-settlement rules govern explicit and normal completion.
Runtime promise metadata stays private in `Promises`.

Catch converts failures to registered plain error records tagged `__error__`.
`Errors` keeps native exception origins in private weak metadata for tracing and
rethrow interoperability; error fields and JSON snapshots contain ordinary data.

Explicit Lisp failure uses `reject`, with no `throw` binding. Both `resolve` and
`reject` require a lexically enclosing promise stage and invoke its captured
callbacks, including from nested functions. Neither form has standalone support.
