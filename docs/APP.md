# Mercury app core

Import the single mutable namespace object from `hg/hg.js`. App data is a plain,
extensible object. Operations are functions in `hg.App`; none require `this`.
Lisp accesses the same namespace as `App` and receives the same app identity.
There is no global current-app variable and no public Stage. Selected Lisp forms
and app-bound operations can imply the runtime instance that owns their code.

Scene `on` forms define named hooks invoked directly by runtime services. Generic
subscriptions use the independent [Events dispatcher](./EVENTS.md).

```js
import hg from '../hg/hg.js';
const app = hg.App.new({ c: 'canvas', w: 512, h: 512, si: 1, ups: 60 });
await hg.App.serve(app, '(on render (c) (clear 0.1 0.2 0.4))');
hg.App.dispose(app);
```

```lisp
(let other (App.new (dict "c" "another-canvas" "ups" 30)))
(await (App.serve other "(on render (c) (clear 0 1 0 1))"))
(App.dispose other)
```

`App.new` is synchronous. Its result has an ordinary `ready` promise for graphics
initialization. `App.serve` and `App.patch` automatically await it, return promises
resolving to the app, and take **source text**, not a path. Fetch a file explicitly in a JS
host and supply `{ sourceURL: url }` as the third argument for relative imports
and located errors. Omitted origin retains the committed scene's origin; while
a replacement initializes, it does not inherit that candidate's temporary origin.

## Serving and patching

`App.serve(app, source, options)` starts fresh scene bindings.
`App.patch(app, source, options)` replaces code while preserving top-level data:

- Match top-level `let` bindings by their names, independently of source position.
- Keep compatible existing data values and identities; skip their new initializers.
- If an existing value fails the new binding's explicit type guard, evaluate its new initializer.
- Initialize new names and omit removed names from the new scene.
- Reevaluate bindings whose current values are functions, and explicit `fn`, `sh`,
  and `async` definitions. Rebuild struct definitions and callbacks.
- Keep function-local and block-local bindings outside preservation.

```js
await hg.App.serve(app, '(let count 1) (set app.state.count count)');
await hg.App.patch(app, '(let count 99) (set app.state.count count)'); // count is 1
await hg.App.serve(app, '(let count 99) (set app.state.count count)'); // count is 99
```

Patching without a current scene initializes all bindings. Removing a name and
reintroducing it in a later patch initializes it again. An outer type assertion
in a top-level `let` initializer checks the previous value before retention. If
it fails, that binding is reinitialized once; the new value must pass the same
guard or the patch rejects. Compatible and unannotated data keep their identity.
This uses the new initializer without converting the old value. Other top-level statements execute
again, so `(set ...)` can deliberately update retained data.

```lisp
; Existing scene:
(let position ((vec2f 1 2) : vec2f))
; Patched source: the old vec2f fails vec3f, so position becomes (3, 4, 5).
(let position ((vec3f 3 4 5) : vec3f))
```

New functions and callbacks close over the new scene's cells. Functions stored
inside retained collections remain part of that retained data. Imported module
memory and `app.state` remain app-owned and survive both operations. Resource
handles retain their identity and existing ownership; patching does not infer
resource disposal from removed or reinitialized bindings. Cleanup remains the
resource owner's responsibility, using its existing lifetime and disposal rules.
Patching does not trace references through collections, closures, app state, or
JS hosts to decide disposal, and retaining a handle does not extend a borrowed
resource's lifetime. Existing attach/detach callbacks still
run, and scheduler clocks retain their existing restart behavior on replacement.
`App.load` is replaced by these two operations.

| Creation option | Meaning | Default |
| --- | --- | --- |
| `c` | Canvas element id, canvas element, or its existing 2D context | null: owned default presentation canvas |
| `w`, `h` | WebGPU rendering dimensions, independently nullable | null: destination bitmap dimensions |
| `si` | Scale increment, retaining the former scale-step behavior | null: continuous fit |
| `is` | Boolean image smoothing during presentation, independent of `si` | false |
| `ups` | Positive finite updates per second | 60 |
| `trace` | Source-located execution tracing and replacement checks | true |

The default canvas uses CSS `100dvw` by `100dvh`; no browser fullscreen request
is made. An owned WebGPU canvas renders independently of the supplied 2D surface.
The runtime manages bitmap sizing only for canvases it creates, using rounded
CSS viewport bounds multiplied by device pixel ratio (minimum one pixel per axis).
Supplied canvas `width` and `height` remain under host control. The host must set
positive bitmap dimensions and handle any desired CSS-size or pixel-ratio changes.
Omitted rendering axes follow the destination bitmap dimensions. Presentation
centers the image in bitmap pixels and clears unused pixels.
`is: false` uses nearest-neighbor scaling; `is: true` enables image smoothing
at any scale increment. Only boolean values are accepted. Runtime-created canvases have a black CSS
background; supplied canvases keep their own styling and may be transparent,
letting their canvas or parent background show through the borders.
Positive `si` rounds fit down to an increment; if none
fits, it keeps one increment and crops symmetrically. Zero/null disables snapping.

CSS resizing of a supplied canvas does not change its rendering resolution.
Bitmap changes are consumed during frame preparation; if an automatic rendering
axis changes, the existing resize callback and GPU reallocation rules apply.
Input and native caret positioning map between CSS and bitmap coordinates.

App fields include `source`, `sourceURL`, `state`, `scene`, `elapsed`,
`updateElapsed`, `dt`, `ups`, `w`, `h`, `si`, `is`, `paused`, `failed`, and `destroyed`.
`state` is the plain per-app dictionary for intentionally shared data, accessible
as the same object in JS and Lisp. Both `serve` and `patch` preserve it. Reads and
writes use ordinary dictionary rules and share live values without copying them;
different apps start with separate dictionaries. There is no separate `Store`
namespace or automatic saving. Explicit JSON saves follow the existing JSON
restrictions, and storing a resource handle does not transfer ownership or extend
its lifetime. Document models and persistence backends remain deferred.
Clock values are observations updated
by scheduling. Changing source data does not compile it: call `App.serve` or `App.patch` explicitly.
During candidate initialization, `source` identifies that candidate; it is restored
on failure and published on successful replacement. Initialization effects on
shared state or retained objects are not rolled back.

Ordinary edits to `w`, `h`, `si`, `is`, and `ups` are validated/consumed at the next frame
boundary. Each app retains its own clock, module cache, input, and GPU resources.
Internal service hooks are implementation details, not a second instance-method API.

```js
const smooth = hg.App.new({ c: 'preview', is: true });
smooth.is = false; // Applied at the next frame boundary.
```

```lisp
(configure is true)
(configure (dict "is" false))
```

`(configure)` includes the requested `is` setting. Smoothing changes request a
fresh presentation of the existing image without resizing the rendering buffer.

Traced loading checks compilation, initialization, attach, and initial rendering
before discarding the working scene. Overlapping loads use the latest request.
Patching pauses scheduled scene callbacks and input delivery while candidate
bindings initialize, including across awaits. A failed traced patch keeps the
previous code and binding cells; mutations to shared objects are not rolled back.
Later frame errors stop that app's scheduling and use the existing console error
path. Structured diagnostic delivery is deferred. `trace: false` retains ordinary
failure behavior. Trace does not isolate infinite loops or device loss.

`App.dispose` is idempotent. It stops scheduling, cancels pending activation, and
releases resources. It removes only runtime-created presentation canvases, even
when disposed during initialization. Caller-supplied canvases remain in the DOM.
Loading a disposed app rejects. Initialization errors remain available through
`ready`, `App.serve`, `App.patch`, and the ordinary `initializationError` field.

`App.tokenize(app, source)` retains the editor's existing incremental tokenizer
capability under the shared namespace. Text-proxy operations now use the shared `TextProxy` namespace and take proxy data explicitly.
Embedded rendering, child ownership, program exports, and diagnostic subscription
APIs are deliberately deferred.

## Pausing and starting

`App.pause(app)` cancels automatic update/render frames and queued event-triggered
render requests. It preserves the scene, clocks, binding references, app state,
and resources, while discarding accumulated update backlog and the previous frame
timestamp. `App.start(app)` resumes scheduling; its first frame uses zero elapsed
wall time, so time spent paused produces no catch-up updates. Repeated starts do
not add animation loops or reset an already running clock.

Both operations are synchronous, require exactly one live app, and return that
app. `app.paused` reports the explicit pause state; use these operations to change
it. Apps default to unpaused and begin scheduling when a scene is attached. You
can pause before readiness or before the first scene, and start before a scene
exists; later scene attachment follows the selected state. Pausing during an
asynchronous attach does not cancel its completion.

`serve` and `patch` preserve explicit pause, including through failed or superseded
drafts. They still run their usual initialization and lifecycle callbacks; traced
replacement still performs its explicit initial-render validation while paused.
Scene replacement retains its existing clock-reset behavior. Pause/start by
themselves neither detach nor reattach the scene.

Inspection, reads, writes, explicit `App.call`, and `App.exec` remain available while paused.
Native input/edit listeners retain their existing delivery behavior, but their
automatic render requests are suppressed. Pausing does not cancel an executing
function or its promises. Runtime failure remains distinct from explicit pause:
start rejects an app stopped by a runtime/input error; source replacement retains
the existing recovery behavior.

```js
hg.App.pause(app);
await hg.App.patch(app, editedSource); // Still paused.
hg.App.start(app);                    // Resume without paused-time catch-up.
```

```lisp
(App.pause other)
(App.read other binding)
(App.start other)
```

## Live binding reflection

Reflection covers top-level scene bindings, including function, shader, struct
definition, and resource-valued bindings. Local variables, active call frames,
and imported module internals are not enumerated. `app.state` remains accessible
through ordinary app-field and dictionary access.

| Operation | Result |
| --- | --- |
| `App.inspect(app)` | A fresh plain dictionary keyed by binding name, containing live binding handles. Before the first scene is committed, it returns an empty dictionary. |
| `App.read(app, reference)` | The binding's current value, without snapshot copying. |
| `App.write(app, reference, value)` | Replaces a mutable binding's value and returns the replacement. |
| `App.call(app, reference, args)` | Resolves the current callable binding, invokes it with the argument list, and returns its result. |

These operations require exactly their listed arguments. Inspect/read/write are
synchronous; call invokes immediately and returns the function's ordinary result
or its original promise.
Handles are registered plain records `{ __type__: '__binding__', name }`.
`(type reference)` returns `"__binding__"`; `binding?` recognizes a registered
handle, not whether it is currently valid. Lisp can read `reference.name` and
`reference.__type__`; those fields cannot be written through language access.
An ordinary dictionary with these fields does not create a binding reference.
Handle identity, ownership, and lifetime are private metadata; editing JS labels
does not retarget a handle. JSON rejects handles rather than serializing references.

```js
await hg.App.serve(app, '(let count (1 : num))');
const bindings = hg.App.inspect(app);
const count = bindings.count;
hg.App.read(app, count);                    // 1
hg.App.write(app, count, 'hello');          // 'hello'; follows ordinary set
await hg.App.patch(app, '(let count (2 : num))');
hg.App.read(app, count);                    // 2; the same handle follows reinitialization
```

```lisp
(let bindings (App.inspect other))
(let count bindings.count)
(App.read other count)
(App.write other count "hello")
```

Inspection discovers the current names; inspect again to discover additions or
removals. Replacing entries in the returned dictionary does not edit scene bindings.
Reading a list, dictionary, or typed value preserves its live identity; edits to
that value use its existing mutation operations and storage validation rules.
Writing a binding follows `set`: initializer type assertions are not rechecked,
and immutable struct definitions cannot be reassigned. Replacement values use
the normal language-value admission rules, including rejecting non-finite scalar
numbers and unsupported native objects; undefined is normalized to nil.

Both ordinary function calls and `App.call` are supported:

```lisp
(let bindings (App.inspect other))
(let action (App.read other bindings.action))
(action 42)
(App.call other bindings.action (list 42))
```

```js
const bindings = hg.App.inspect(app);
const action = hg.App.read(app, bindings.action);
action(42);
hg.App.call(app, bindings.action, [42]);
```

`App.call` requires a native list of arguments, including an empty list for a
zero-argument call. Arguments use normal language-value admission without copying
compound values; the function keeps its own parameter checks and lexical app
environment. Arguments and results use ordinary Lisp nil normalization. Calls
execute immediately, including when scheduled app updates are
stopped, and do not resume scheduling. They propagate synchronous errors and retain
the function's original promise and rejection behavior. No app, render context,
or other argument is supplied implicitly; shader calls still need their usual
context and resource ownership checks.

`App.call` resolves the current binding on every invocation, so an existing handle
calls replacement functions after a patch. A function saved from `App.read` is
that particular function value and does not automatically change after a patch.

References follow same-name bindings across committed patches, including
reinitialized values and replaced functions/shaders. Removal, fresh `serve`, or
app disposal permanently invalidates old references; reintroducing a removed name
does not revive them. Uncommitted candidate scenes do not change active references.
This binding lifetime does not extend the lifetime of a referenced resource value.
Texture and binding handles use registered JS object identity; no generic ref
registry, UUID reference table, or generic acquire/resolve/release API is planned.
Reading, writing, or calling forged, invalidated, or another app's references rejects with a
TypeError. Operations require a live app and its active committed scene; they
do not initialize an app, change source initializers, or save data. Inspect/read/write
do not execute scene code; call runs the referenced function and its ordinary effects.

## Top-level execution

`App.exec(app, source)` executes Lisp source text in the target app's active
top-level environment. It requires exactly two arguments, initialized graphics,
and a committed scene that is not attaching or being replaced. It runs immediately,
including while paused, and does not resume scheduling or reset clocks.

```js
await hg.App.serve(app, '(let count 0)');
hg.App.exec(app, '(let increment (fn () { (set count (+ count 1)) }))');
hg.App.exec(app, '(increment)'); // 1
hg.App.read(app, hg.App.inspect(app).count); // 1
```

```lisp
(App.exec other "(let debug-count 0)")
(App.exec other "(set debug-count (+ debug-count 1))")
; Function and block locals keep their ordinary temporary scope.
(App.exec other "((fn () { (let temporary 42) temporary }))")
```

Execution shares existing binding cells with the scene and its functions.
Top-level `let` and `struct` declarations persist, become visible through
`App.inspect`, and are available to subsequent injections. Duplicate declarations
are rejected; use `set` to replace mutable binding values. Struct definitions
retain their immutable binding and compile-time layout information. Reserved
literals and ordinary lexical scoping retain their existing rules. Previously
compiled functions retain their lexical environment; injection does not recompile
them to recognize newly introduced names.

Top-level `on` updates the active scene's named callback. Defining `attach` or
`detach` does not invoke it immediately; these callbacks run on the usual lifecycle
transition. Standalone imports extend the top-level import environment for later
injections, using the app's module cache and current source origin. Imported module
internals remain outside scene binding reflection. Text, shaders, and other
resources use the target app's existing services and ownership rules.
Relative imports use the committed scene's source origin. Imported module execution
does not substitute the app's source fields; each module captures its own origin
for imports within that module.

The final value expression is returned, or nil for an empty body or a final
statement. Top-level `await` returns a registered promise; otherwise results,
including ordinary promise values, keep their identity. Synchronous compilation
and execution errors propagate to the caller; asynchronous failures reject the
returned promise. Execution does not automatically mark the scene as failed.
Compilation completes before Lisp statements run. Completed declarations, writes,
and other effects remain if a later statement fails; there is no rollback.
If the app is disposed or the target scene is replaced while execution awaits,
later top-level statements and asynchronous completion reject. This does not
cancel functions or promises already running in their original lexical environment.

`exec` does not edit, append to, or replace `app.source` or `app.sourceURL`.
Injection text remains attached to its own compiled diagnostics. Injected bindings
follow the existing replacement policy: `patch` preserves compatible matching data
names and removes names absent from the new source; `serve` starts fresh. Neither
operation saves injected code into the source. Resource cleanup remains with its owner.

## Current-instance Lisp forms

Namespace calls such as `(App.pause other)` retain their explicit target, matching
JavaScript. Selected Lisp forms may instead refer to their owning app implicitly.
Existing app-specific operations such as `clear`, `import`, and `set-scene` already
capture runtime services; `on` defines hooks on the compiled scene.

Additional current-app forms are approved in principle and deferred for a later
batch covering multiple operations together, including proposed `pause`/`start`
shorthand. Their operations and exact spellings will be selected then.
They should capture the app that owns the code,
including nested functions and asynchronous continuations. Calling a function
from another runtime must not switch that ownership. No global current-app state
or blanket omission of namespace instance arguments is introduced. Generic event
dispatchers remain independent explicitly supplied instances until a specific
implicit events context is agreed.

## Hosts

`index.html` loads `index.js` for the vanilla staging environment: a textarea,
Serve/Patch buttons, error text, and canvas, with no custom page CSS.
`editor/index.html` loads `editor/index.js` and retains the existing canvas editor
as a regression fixture. Internal compiler/scheduler helpers are
in `hg/`; they are not re-exported as a legacy runtime surface.

See [explicit storage access](./ACCESSORS.md) for retained language storage behavior.
