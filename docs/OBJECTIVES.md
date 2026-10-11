# Mercury (hg) core rewrite objectives

Additional implementation references and examples have been reviewed in
[REFERENCE-REVIEW.md](./REFERENCE-REVIEW.md). They inform composition; behavior
differences remain subject to discussion except for agreed numeric clamping and
native list/dict representation, native JSON, finite numeric values, named vector
fields, scalar constructor defaults, nil construction, numeric string/literal
parsing with colon-letter conversion suffixes, and dictionary/vector construction.
Boolean literals are retained; strings/templates use modern JS escapes and `$"`.
Access uses computed dot selectors and single-argument `get` for binding/path lookup.
Functions/handlers implicitly return their final value expression; explicit `return` remains available for early exits.
`async` wraps functions; `promise` constructs/chains stages, with explicit `resolve`/`reject` exits and normal completion retained.
Catch receives custom `{ __type__: "__error__", name, message }` records with the `error` guard type.
The Lisp `throw` binding is omitted; `resolve`/`reject` require a lexically enclosing promise stage, including captures in nested functions.
Booleans cannot cross the host/GPU boundary, including nested fields and collection elements; shader-local booleans remain supported.
`(type value)` returns a dunder type string; only scalar numbers share `"__num__"`, since their runtime representation is a JS number.
Shader helpers capture lexical bindings; read-only captures pass by copy and captures possibly written by the helper or its callees use hidden WGSL pointers.
Raw `js`/`gl` forms are deferred; their syntax and interop contracts remain open.
`texture3d` is deferred; keep the existing `texture2d` API without adding a
placeholder 3D texture type or creation/upload/sampling operations in this pass.
Scene execution adopts fresh `App.serve` and preserving `App.patch` operations.
Patches preserve compatible top-level data bindings by name, reinitialize values
that fail a new explicit type guard, and replace function/shader definitions;
see [the implemented contract](./APP.md#serving-and-patching).
Keep cleanup with resource owners rather than infer disposal from scene binding
removal or reinitialization; preserve existing borrowed-handle lifetime rules.
Keep the plain per-app `app.state` dictionary for intentionally shared data across
scenes, retaining live value identity and explicit saving without a separate `Store` API.
Pause/start preserve scene data and resources, resume without paused-time catch-up,
and avoid duplicate loops. Preserve explicit pause through source replacement and
keep reflection and explicit calls available; see [the contract](./APP.md#pausing-and-starting).
`App.exec` runs injected code in the target runtime's live top-level environment.
New top-level bindings persist and share normal reflection and replacement rules;
execution does not edit the stored source. Temporary locals use ordinary lexical
scope. See [top-level execution](./APP.md#top-level-execution).

Current pass: implement the plain Mercury App core and vanilla textarea/canvas
staging environment. Embedded child creation, program exports, diagnostic delivery,
and text-proxy replacement are deferred by the project owner. `si` retains the
former scale-step behavior. See [implemented App contract](./APP.md).


Implementation update: engine modules now live in one `hg/` folder; namespace APIs, explicit storage access, and TextProxy calls follow `STYLE.md`. See [architecture](./ARCHITECTURE.md).

Status: planning contract, October 8, 2026. This document records requirements
from the project discussion. [API-DESIGN.md](./API-DESIGN.md) explores a public
surface; its proposed names and examples are not approved bindings.

## Outcome

The runtime is being rebranded from Aioli to Mercury, abbreviated `hg`.
The editor can create, manage, inspect, and display other Mercury applications.
JavaScript and Lisp use the same intentional runtime model.
Every app has its own clock and lifecycle. App is the central execution and
ownership unit; there is no separate public Stage abstraction. The editor remains usable
when a child reports an ordinary program failure.

The rewrite should produce a small, compositional foundation rather than a
collection of editor-specific commands. The same capabilities must be useful
to JavaScript hosts, Lisp applications, and future editors.

## Agreed requirements

- Use plain JavaScript objects and factory functions instead of classes. This
  includes Aioli, Stage, and ModuleLoader, not just the exported constructor.
- Separate functions from instance data. The browser imports a single plain
  namespace object `hg`; relevant operations live in its namespaces. App data
  carries no instance methods. `hg.App.new(options)` is an ordinary function,
  never a class constructor or a use of JavaScript's `new` keyword.
- There is no implicit global application state. `hg.App.serve(app, source)` takes
  its target explicitly. The `hg` namespace holds functions, not an ambient
  current app/scene. Execution state, module caches, clocks, and resource ownership
  belong to explicit app data or explicitly supplied shared services.
- Selected Lisp forms may imply the app that owns their compiled code. Keep
  namespace calls explicit and capture ownership across functions and async
  continuations; defer additional shorthand forms for a later batch covering
  multiple operations together.
- Scene `on` declarations define named runtime hooks. Generic events use independent
  `Events.new/on/off/emit` dispatchers; see [the implemented contract](./EVENTS.md).
- Use the supplied initialization vocabulary: `c`, `w`, `h`, `si`, `is`, and `ups`.
  `c` accepts a canvas element id, canvas element, or 2D context; omitted/null
  creates an owned `100dvw` by `100dvh` presentation canvas. `w`/`h` optionally
  fix WebGPU rendering dimensions; omitted/null axes track the destination bitmap.
  Supplied canvas bitmap dimensions belong to the host; owned canvases follow CSS
  viewport bounds multiplied by device pixel ratio. `si` is an optional scale
  increment, default null. Boolean `is` independently controls image smoothing
  and defaults to false. `ups` defaults to 60.
- Stop freezing objects. Include existing language wrappers, metadata, and
  resource handles in the audit; do not limit this requirement to new runtimes.
  Do not substitute sealing or non-writable descriptors as a workaround.
- Prefer ordinary data access and explicit function calls. Reading or assigning
  a property must not secretly compile, render, schedule, fetch, or send input.
  Retain a getter or setter only when necessary, and document its exact behavior.
- Preserve mutability and extension of public objects. Explain field ownership
  and the effects of supported edits rather than enforcing policy through freezes.
- JS and Lisp should share names, argument meaning, results, and asynchronous
  behavior. Adapt language representation without inventing a second runtime API.
- JS namespaces are packaged under `hg`; Lisp accesses those namespaces directly.
  For example, `hg.App.new(options)` maps to `(App.new options)` and
  `hg.App.serve(app, source)` maps to `(App.serve app source)`. This is namespace
  exposure, not an implicit global current app or a second set of operations.
- Each instance owns its execution clock and lifecycle; the parent can introspect
  its runtime. Independent scheduling does not imply a worker or separate process.
- All visible editor and preview UI is composed through the WebGPU canvas.
  Invisible browser text services remain acceptable.
- Browser-host initialization without a supplied canvas creates a default
  canvas sized to `100dvw` by `100dvh`, owned by the runtime. This does not invoke
  the browser Fullscreen API. Embedded children render into textures
  without creating a full-screen browser surface.
- Keep owned rendering separate from host presentation. Support a defensive
  two-canvas presentation strategy for externally supplied canvases; a second
  presentation canvas is not a requirement of every instance.
- Use Mercury (`hg`) as the new runtime name, with App at the center of execution,
  lifecycle, rendering, and introspection. App operations take app data; do not
  introduce `app.stage` or a public `hg.Stage` namespace. Existing Aioli/Stage
  names and paths below describe migration inputs. The editor's
  branding has not been changed by this decision.
- Discuss new bindings before implementing them. In particular, text rendering
  and editing API decisions remain collaborative design work.
- Preserve the performance improvements and trace behavior already established.
- Keep JavaScript as the CPU execution target and WGSL for GPU shaders. Wasm
  lowering and a Wasm runtime/backend are out of scope for this rewrite.
- Breaking changes are expected and acceptable. Prefer the coherent Mercury
  contract over compatibility with Aioli's public surface. Do not add aliases,
  overloads, legacy bindings, or compatibility shims solely to preserve old APIs.
  Update repository hosts, editor scripts, examples, tests, and documentation
  together to use the new contract.
- Leave commits and pushes to the project owner.

## Responsibility boundaries

The runtime owns execution, resource lifetimes, source/module loading, input
delivery, graphics output, and diagnostics. Lisp owns document models, debounce,
layout, preview placement, error presentation, inspectors, and editor commands.

Keep `app.state` for data explicitly shared across scenes. Initial reflection
targets top-level scene bindings; those bindings need not move into `app.state`
to become inspectable. Block/function locals and active call frames remain
deferred. Reflection exposes live binding references with explicit inspect/read/write
operations. References follow same-name bindings across committed patches, including
reinitialization, and are permanently invalidated by removal, a fresh scene, or app
disposal. Implemented: inspection returns a plain dictionary of registered binding
handles by name; reads return live values and writes follow `set` without reapplying
initializer assertions. See [live binding reflection](./APP.md#live-binding-reflection).
Support ordinary function invocation and `App.call` through a live binding handle;
the latter resolves the current function and invokes immediately with an explicit
argument list, preserving normal returns, promises, errors, and parameter checks.
Document models, persistence backends, and the `text-proxy`
contract remain separate design decisions.

Input adaptation, editable text, selection, and drawing geometry need separate
responsibilities that compose. That does not mean exposing one new top-level
binding for every responsibility.

## Pre-rewrite implementation audit

Paths below identify the current replacement modules; the mechanism column records
the original audit.

| Area | Original mechanism | Rewrite obligation |
| --- | --- | --- |
| `hg/app.js` | Aioli class; separate Lisp context dictionary | Replace with a factory and reconcile the JS/Lisp public surface and identity. |
| `hg/scheduler.js` | Stage class; implicit clock and scheduling fields | Fold clock/lifecycle responsibility into App; scheduling helpers may remain internal, with independent app clocks. |
| `hg/modules.js` | ModuleLoader class; namespace and import-cell accessors | Plain loader; preserve live imports and assignments with explicit ordinary storage, or document a necessary accessor exception. |
| `hg/graphics.js` | Device per instance; canvas requirement; frozen texture handles | Embedded output and resource ownership, mutable handles, parent composition. |
| `hg/data.js` | Frozen wrappers, sealed numeric arrays, matrix row accessors, lazy-list Proxy | Mutable representation; preserve identity, type checks, aliasing, and snapshot stability without hidden access where practical. |
| `hg/structures.js` | Frozen layouts/handles/constructors; accessor-backed storage and revisions | Audit every descriptor; explicit storage/cells or documented necessary view behavior. |
| `hg/numeric-types.js` | Frozen type tables and metadata | Ordinary mutable metadata with clear validation and cache invalidation rules. |
| `hg/tokenize.js` | Frozen span wrappers; deferred list projection | Preserve exact source positions, old snapshots, incremental lexing, and viewport-scale work. |
| `hg/text-proxy.js` | Document, selection, native input, indexing, and IME bundled together | Revisit composition with the owner; preserve native editing and bounded large-file cost during migration. |

This inventory is a starting point, not permission to retain existing mechanisms.
Search the full repository again during the rewrite. Tests that assume freezing
must change with the contract, rather than making freezing an accidental requirement.

## Access and mutation rules

Namespace functions take the data they operate on explicitly, without a `this`
receiver or `.bind()` requirement. They should work when stored or passed as
functions. If an operation uses a replaceable hook, it should read the current
hook rather than capture an obsolete copy. Function namespaces and app data
must remain separate in both JS and Lisp.

Changing configuration data can affect the next explicit operation or scheduled
tick without a setter. Document when it is consumed and validated. Changing an
observation snapshot does not change the running program; identify snapshots as
such. Do not present a stale copy as live state.

Mutable GPU/type metadata still needs validation at the boundaries where it is
consumed. Allowing mutable objects does not make invalid storage layouts valid.
Never let cached descriptors silently disagree with edited metadata.

For every retained getter, setter, or Proxy, record: file and property, why ordinary
storage or an explicit call is insufficient, the work performed on access, mutation
and aliasing semantics, and performance/lifetime implications. Label it an exception
under review until agreed. No access exceptions are approved by this document.

## Decisions to resolve before the corresponding implementation

1. Creation and readiness: `hg.App.new(options)` returns app data synchronously
   in the supplied example. Decide how asynchronous GPU initialization is handled
   by subsequent operations, and how embedded child creation is expressed.
2. Public execution vocabulary: source versus URL loading, replacement, and whether
   compiled programs need a public execution interface. Avoid forwarding every
   current internal method into Lisp.
3. Introspection: direct runtime data, explicit observation snapshots, application
   exports, mutable binding cells, and optional trace-based local inspection.
4. Lifetime: parent ownership, editor self-reload, disposal, output borrowing, and
   whether children can be transferred or detached from their parent.
5. Graphics: shared-device embedded rendering versus independent-device output;
   output publication, resize, and asynchronous failure attribution.
6. Diagnostics: structured payload, operation rejection versus notification,
   revision identity, retention, and the meaning of fatal failure.
7. Input: focus, pointer ownership/cancellation, coordinates, held input state, and
   child text/IME routing. Forwarding a callback alone is insufficient.
8. Text composition and persistence: replace the current bundled contract only
   after representative editing examples are agreed.
9. Ordinary mutable replacements for live storage views and lazy snapshots;
   resolve any necessary access exceptions explicitly.
10. Initialization details: element-id lookup, cross-document contexts, omitted
    versus null options, single-axis sizing, scale-increment rounding and downscale
    behavior, validation timing, and failure/disposal during GPU initialization.

## Rewrite sequence

1. Agree paired JS/Lisp examples and lifecycle/error semantics. Audit access
   mechanisms and identify dependencies before choosing representations.
2. Move scheduling/lifecycle responsibility from Stage into the plain App data
   and namespace model; convert module orchestration to plain objects. Preserve
   behavior and make ownership and execution state explicit.
3. Reconcile the Mercury namespace/data surface and Lisp representation. Migrate
   hosts and the editor together, accepting breaking changes without retaining
   obsolete APIs for compatibility.
4. Add embedded graphics and independent child instances through the agreed
   surface. Keep resource ownership separate from presentation layout.
5. Add runtime/program introspection and structured diagnostics. Verify failing
   candidates, stale asynchronous results, and child cleanup.
6. Rework state/text composition and accessor-backed language representations
   in measured increments. Do not turn the syntax-coloring hot path into eager
   whole-document object construction.
7. Remove superseded APIs and update the current architecture/contracts, examples,
   and tests. Do not ship a parallel legacy surface.

Steps describe dependencies, not authorization to invent unresolved APIs.

## Acceptance scenarios

- Paired JS/Lisp programs create an instance, load/reload source, inspect it,
  use its output, control its lifecycle, and dispose it with equivalent semantics.
- Both languages use namespace functions with explicit app data. App data has
  no attached runtime methods, and functions do not depend on an implicit receiver.
  Selected Lisp forms can supply their owning app through lexical capture.
- A browser host can initialize without supplying a canvas: its owned full-screen
  surface follows viewport changes and is removed on disposal or failed
  initialization. Supplied canvases are retained on disposal. Embedded children
  do not create browser presentation surfaces.
- Two children advance independently; pausing one leaves the other and the editor
  running. Inspection does not advance a child's clock or render it.
- Lisp composes two child outputs using the ordinary graphics system without
  browser preview widgets, pixel readback, or a dedicated preview renderer.
- The parent sees active source, clock/lifecycle information, application-exposed
  bindings, and source-located errors. Local lexical inspection remains distinct
  from application exports.
- Invalid compilation/initialization/first rendering does not destroy the working
  traced scene. Later update/render/input failures are attributed to the child.
- Overlapping reloads and asynchronous GPU errors carry enough identity to avoid
  replacing a newer scene or attaching an obsolete diagnostic to current source.
- Disposal cancels pending activation, stops scheduling, releases owned resources,
  and gives deterministic behavior for outstanding output references.
- Editor self-reload follows the agreed child persistence rule without leaking
  clocks, subscriptions, proxies, or GPU resources.
- Module live assignments, numeric/struct storage aliases, imports, and shader
  packing continue to behave correctly after representation changes.
- Typing, scrolling, IME, selection, large-file editing, and error recovery remain
  usable. Compare traced benchmarks against `docs/PERFORMANCE.md`; measure
  allocation, idle work, and child-output composition as well as typing latency.
- The public `hg` namespace and runtime data are plain, extensible, and unfrozen. Every retained
  accessor/Proxy has an explicit documented rationale and agreed contract.

Same-thread execution cannot contain an infinite loop. A shared GPU device can
fail for every user of that device. Do not describe separate runtime state or
trace instrumentation as process isolation; worker isolation is a separate design.
