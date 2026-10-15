# Mercury (hg): shared JavaScript and Lisp runtime surface

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
Scene execution adopts fresh `App.loadSource` and preserving `App.patchSource` operations.
Patches match top-level data bindings by name, skip compatible retained initializers,
reinitialize values that fail a new explicit type guard, and replace function/shader
definitions. See [the implemented contract](./APP.md#loading-and-patching).
Resource owners remain responsible for cleanup; removed or reinitialized scene
bindings do not trigger resource disposal or transfer ownership.
Use the existing plain per-app `app.state` dictionary for intentionally shared
data across scenes, with shared live values and explicit saving rather than a
separate `Store` namespace.
`App.pause` and `App.start` control automatic scheduling, preserving the scene and
resources, avoiding duplicate loops and paused-time catch-up. Explicit pause survives
`load` and `patch`; reflection and explicit calls remain available. See
[pausing and starting](./APP.md#pausing-and-starting).

Current application: the plain Mercury App core and Mercury canvas editor, hosted
by `index.html` and `index.js`. Embedded child creation, program exports, diagnostic delivery,
and text-proxy replacement are deferred by the project owner. `si` retains the
former scale-step behavior. See [implemented App contract](./APP.md).


Implementation update: engine modules now live in one `hg/` folder; namespace APIs, explicit storage access, and TextProxy calls follow `STYLE.md`. See [architecture](./ARCHITECTURE.md).

Status: design discussion, October 8, 2026. The `hg` branding, namespace/data split,
and initialization example below come from the project owner. Additional operation
signatures remain proposals, not implemented bindings. [OBJECTIVES.md](./OBJECTIVES.md) contains the agreed
requirements, implementation audit, migration sequence, and acceptance scenarios.

## Design test

This is a breaking rewrite. Existing Aioli APIs inform the behavior audit but
do not constrain Mercury's public signatures or representations. Update callers
to the agreed design rather than adding compatibility aliases or a second legacy
surface. JavaScript remains the CPU compilation target, with WGSL for shaders;
Wasm is out of scope.

App data should feel like the same value in JS and Lisp. It should be possible
to pass it to a namespace function, store it in a collection, inspect ordinary
data, and compose its output without a second vocabulary of editor commands.
Each added operation must represent a real capability boundary.

Prefer factory functions returning object literals. Do not replace classes with
prototype constructors, accessor-heavy facades, or opaque objects that are plain
in name only. Internal closure state is appropriate for resource ownership, but
it must not make the advertised introspection surface misleading.

Texture handles expose `__type__: '__texture2d__'` as plain metadata while resource
ownership remains private. Lisp type queries and predicates use registered identity;
copying the marker into a dictionary does not create a resource handle. The owner
ruled out a generic ref registry: retain registered object identity without UUID
reference tables or generic acquire/resolve/release operations.

The runtime is Mercury, abbreviated `hg`. The browser imports a single plain
object `hg` containing function namespaces. Relevant functions belong to those
namespaces; instance data does not carry methods. JavaScript accesses namespaces
through `hg` (for example, `hg.App.new`); Lisp refers to them directly (`App.new`).
The namespace members, arguments, results, and operation semantics are the same.
Selected Lisp forms may supply their owning app implicitly through compiler/runtime
capture; namespace calls keep explicit instance arguments. `pause`, `start`,
`load-source`, `patch-source`, `load`, `patch`, and `exec` are implemented as
app-capturing callable bindings; additional
shorthand remains deferred. Scene `on` declarations are named runtime hooks; generic events
use the implemented independent [Events namespace](./EVENTS.md).
The `hg` prefix is JS module packaging, not part of Lisp names and not an implicit
current app. No camelCase/kebab-case alias system is needed. The earlier proposed
`Aioli(...)` factory and `preview.reload(...)` instance methods are superseded.

## Initialization supplied by the project owner

`new` here is a property name holding a normal factory function. There are no
classes and no JavaScript `new` expressions.

```js
const app = hg.App.new({
  c: myCanvas,
  w: 512,
  h: 512,
  si: 1,
  ups: 60,
});
```

```lisp
(let app (App.new (dict
  "c" myCanvas
  "w" 512
  "h" 512
  "si" 1
  "ups" 60)))
```

The Lisp example demonstrates direct namespace access and matching option names. Exposure of host
canvas/context references to Lisp is not yet decided; ordinary Lisp creation can
omit `c`. The representation bridge must preserve app identity without making JS
objects arbitrary unvalidated language collections.

| Option | Supplied meaning | Default |
| --- | --- | --- |
| `c` | Presentation canvas element id, canvas element, or 2D canvas context | null/nil: create an owned default canvas |
| `w` | WebGPU rendering width | null/nil: follow presentation width |
| `h` | WebGPU rendering height | null/nil: follow presentation height |
| `si` | Scale increment for WebGPU output within the presentation canvas | null/nil: no scale increment |
| `is` | Boolean image smoothing, independent of the scale increment | false |
| `ups` | Updates per second for this app | 60 |

Resolve `c` to the supplied element or context's canvas, preserving a supplied
2D context rather than trying to claim it for WebGPU. Supplied canvas bitmap
dimensions belong to the host. Runtime-created canvases follow CSS viewport
bounds multiplied by device pixel ratio. Automatic rendering axes follow the
destination bitmap. Explicit `w`/`h` override their respective rendering axes.
These are rendering dimensions, not CSS dimensions. Input and native caret
positioning account for the ratio between CSS bounds and bitmap dimensions.

`si` expresses an increment, not a fixed scale factor. It retains the existing
scale-step behavior: round the fit down to an increment, retain one increment
and crop symmetrically if none fits, and disable snapping for zero/null.
Missing and explicit null options should support the supplied defaults. JS
`undefined` handling and invalid-value diagnostics need a consistent contract.

`is` is an explicit boolean setting and does not derive from `si`. Creation,
`app.is`, and Lisp `(configure is true)` share the same setting. Its default is
false; non-booleans, including null/nil, are rejected. Changes apply at the next
frame boundary and trigger presentation even without a new scene draw.

The synchronous call returns app data. GPU creation is asynchronous. The implemented
`App.loadSource` and `App.patchSource` await the app's `ready` promise. Reading app data never performs
initialization. Initialization failures reject readiness/loading and are retained
on the app; unobserved rejection is prevented without discarding the failure.

## Explicit operation target

The corrected namespace signature is `hg.App.loadSource(app, source)`. Its target is
explicit. There is no global application state or dynamically selected current app;
selected Lisp forms can capture their owning runtime:

```js
await hg.App.loadSource(app, source);
```

```lisp
(await (App.loadSource app source))
```

The explicit target is agreed. `App.loadSource` and `App.patchSource` take source
text, optionally with `{ sourceURL }` in their third argument. `App.load` and
`App.patch` fetch URLs and use the same fresh/preserving replacement lifecycle.
All four return promises resolving to the app and share request supersession.
Do not infer source versus URL from string contents or add a current-app
namespace overload omitting the app. Lisp URL shorthand captures the defining
program's origin for relative paths.

The `hg` namespace contains operations, not hidden app state. Execution state,
clocks, module caches, and ownership live with explicit app data or explicitly
provided shared services. Creating or loading one app must not change the target
or defaults of operations on another app.

App is the central unit. Lifecycle, clock, rendering, and introspection operations
take app data and belong to `hg.App`. Do not add a public `hg.Stage` namespace or
require callers to navigate through `app.stage`. Internal scheduling helpers can
remain modular without becoming a second public execution object. Other functions
follow the namespace/data separation; not every data structure needs a namespace.

Embedded creation still needs a contract distinguishing output-to-parent from
browser-host presentation. An embedded child must not accidentally create a default
full-screen canvas. GPU sharing and child survival across editor reload also remain
ownership decisions; they are not implied by the initialization options above.

## Browser presentation and default canvas

Browser-host initialization without a supplied canvas creates and owns a default
canvas with CSS width `100dvw` and height `100dvh`. Embedded child initialization has a different presentation
destination: its output is consumed by the parent, so omitting a canvas there
must not create a second full-screen surface. `c` is the supplied browser-host
option; the embedded creation form remains open. Default presentation and embedded
output are distinct behaviors.

Keep rendering resources independent of the host surface. An externally supplied
canvas may already have a 2D context or be managed by other code. Preserve the
defensive path of presenting an owned WebGPU canvas into that supplied surface.
Direct WebGPU presentation is possible when the supplied canvas can be claimed
for it. Validate capabilities and ownership rather than silently assuming them.

The presentation adapter observes the visible canvas's bounding rectangle, manages
the agreed bitmap dimensions, and handles scaling and input coordinate conversion.
A default surface follows the dynamic viewport without rewriting the host page's
global styles. "Full-screen" means `100dvw` by `100dvh`; it never requests browser
fullscreen mode.

Disposal and failed initialization remove runtime-created presentation canvases
and their listeners/observers. A caller-supplied canvas is never removed. Define
which temporary canvas attributes are restored, and distinguish bitmap management
from CSS layout ownership. Neither one nor two canvases can prevent another script
from drawing over an externally shared presentation surface.

## Candidate conceptual structure

| Member | Meaning | Access rule |
| --- | --- | --- |
| App data | Identity, ownership, clock, scheduling configuration, execution status, and lifecycle observations | Ordinary mutable data; operations live in `hg.App`, not on app data or a separate Stage. |
| `program` | Active source identity and application exports | Ordinary data/cells or an explicitly requested snapshot; no secretly executing namespace getters. |
| `output` | Latest completed graphics image available to the parent | Ordinary published resource reference, not a getter that renders on access. |
| Diagnostics/hook | Structured failures attributable to this instance and revision | Ordinary data and an explicit callback; final spelling/retention unresolved. |

This is a conceptual grouping, not a requirement to create five new wrapper types.
Use the existing language's values and textures where their semantics fit.

Do not mirror `compile`, `run`, `compileScene`, `activate`, `setScene`, `load`, and
`reload` mechanically. Decide which operations callers actually need, then keep
the supporting compiler/orchestration machinery internal or expose it deliberately
as a separate compiler capability. Source loading and URL loading must be explicit
and must not be guessed from a string's contents.

## Observation, mutation, and composition

Ordinary property access reads stored data. It must not poll, fetch, execute Lisp,
advance an app's clock, render a frame, or materialize an undocumented remote query.

Configuration can be ordinary mutable data, validated when consumed. For example,
changing an update rate may take effect at the next app update boundary. Document that
boundary. Functions stored in namespaces must not require a `this` receiver.
Keep application callbacks and operational functions conceptually distinct; the
location and replacement contract of diagnostic callbacks remain to be decided.

Runtime observations may be published into ordinary fields at explicit lifecycle
boundaries. If consistency requires a snapshot, request it with an explicit call
and return an ordinary mutable value. Do not introduce an inspector method merely
as a prerequisite to reading every normal field.

Editing program source data does not itself compile or reload it. Loading new source
is an explicit operation. Decide how candidate source is visible during initialization
without confusing the parent's active program with an uncommitted replacement.

For application exports, consider ordinary binding cells such as `{ value }`.
The compiler and both languages could read/write the same ordinary storage, avoiding
the current module namespace accessors. This would make live mutation explicit,
but adds `.value` to access paths and changes imports/code generation. Compare it
against a deliberately documented live-view exception before choosing. Do not
pretend a copied namespace provides live mutation.

Initial reflection is limited to top-level scene bindings, including bindings
whose values are functions, shaders, or resource handles. Block/function locals
and active call frames remain deferred. Adopt live binding references for reflection:
`App.inspect` enumerates references, `App.read` observes their current values, and
`App.write` explicitly replaces binding values. Inspection entries are not copied
values presented as live storage. Binding references follow same-name bindings
through committed patches, including reinitialized values and replaced code
definitions. Removing a binding, loading a fresh scene, or disposing the app
permanently invalidates its old references; reintroducing a name does not revive
them. Uncommitted candidate scenes do not change active references.
Implemented: inspection returns a plain dictionary keyed by name containing
registered `{ __type__: '__binding__', name }` handles. Reads return live values;
writes follow `set`, preserving immutable bindings without reapplying initializer
assertions. Handle metadata is read-only in Lisp, ownership is checked on read/write,
and JSON rejects handles. See [live binding reflection](./APP.md#live-binding-reflection).
Both ordinary invocation of functions returned by `App.read` and explicit
`App.call(app, reference, args)` are implemented. Call resolves the current binding
and invokes immediately with an explicit argument list, retaining lexical context,
parameter checks, return values, promises, and errors; it does not resume scheduling
or supply implicit arguments. Cached function values retain their own identity
while calls through binding handles follow patched definitions.
`App.exec(app, source)` is implemented as live top-level injection, including new
persistent bindings, existing-cell mutation, and callback declarations. It leaves
stored source unchanged; temporary scope uses ordinary functions or blocks.
See [top-level execution](./APP.md#top-level-execution) for completion, replacement,
and failure behavior.
Ordinary application exports remain a separate proposal from this reflection surface.
Use `app.state` explicitly for data that should survive fresh scenes. Other
application values remain ordinary scoped bindings; state is not mandatory for
introspection. Persistence beyond the app still requires an explicit save.

Output is consumed by existing texture/shader operations. Reading it should return
the last published completed image, with an explicit empty state before the first
image. Define whether an output reference is a stable surface or a frame image,
how long it remains usable, and what resize/disposal does to it before implementation.
Never expose a recycled GPU target as an indefinitely valid saved image.

## Diagnostics and failure boundaries

Use one structured diagnostic representation in JS and Lisp. Preserve message,
phase, source URL/range when available, trace frames, instance/program identity,
revision, and whether execution stopped. Exact field names remain open. A formatted
string is useful presentation data, not a replacement for that structure.

Distinguish failed replacement from failed execution. A traced replacement should
retain its working predecessor when compilation, attach, or first rendering fails.
Specify later-frame and asynchronous graphics handling separately; the current
first-render rollback does not contain every GPU failure.

An operation rejection and an asynchronous notification must be correlatable so
the editor can avoid displaying the same error twice. Parent error formatting and
inspector layout remain Lisp work. Trace enriches diagnostics; it does not promise
containment of infinite loops or shared-device loss.

## Input and text

The editor chooses focus, preview bounds, and placement. Runtime input delivery
must maintain the child's held-key/pointer state as well as invoke callbacks.
Coordinate conversion, capture, blur/cancellation, gamepad ownership, and IME
anchoring need one coherent contract. Do not implement a generic dispatch method
that forwards callbacks but leaves input queries stale.

Revisit text through actual composition examples: a document rendered in two views,
selection independent of drawing, native input bound to the focused view, and a
buffer surviving editor reload. Avoid carrying the current all-in-one proxy into
the new surface unchanged or expanding it with unrelated runtime management.
No text API names or bindings are chosen in this document.

## Examples the contract must support before implementation

1. A JS host and a Lisp editor create and dispose equivalent runtimes.
2. Two running children render into a parent; pause one and inspect both clocks.
3. Show a child program's exported data and invoke an exposed function.
4. Mutate an exposed binding using the agreed cell/view model and observe the
   child's own execution use the change.
5. Reload bad source, display its diagnostic, then successfully reload good source.
6. Attribute a late GPU error to the correct revision after a newer edit.
7. Move input focus between source and preview without leaving held state behind.
8. Reload the editor itself with the agreed child/persistence ownership behavior.
9. Pass or wrap a namespace function without hidden receiver requirements, and
   inspect app data without invoking operations.

If these examples need special editor-only escape hatches, repeated adapter methods,
or undocumented property dispatch, revisit the model before adding bindings.
