

### JavaScript

- Keep engine/compiler/library modules in `hg/`, automation in `hg/tools/`, tests in `hg/tests/`, documentation in `docs/`, examples and additional hosts in `examples/`, and the editor's `index.html`, `index.js`, and Lisp files in `editor/`; retain the staging `index.html` and `index.js` at the repository root
- Prefer `const` over `let`
- Avoid `var` and unscoped declarations
- Prefer dunder names to indicate private fields and methods; use both a double-underscore prefix and suffix, e.g. `__name__`
- Separate state from behavior (e.g. no classes)
- Prefer explicit over implicit dispatch (e.g. no getters or setters)
- Prefer plain js data (e.g. no classes, prefer json-serializable types); lists are native JS arrays and dictionaries are plain untyped objects
- Prefer functions over methods (e.g. functions that operate on a type should accept an instance as the first argument)
- Prefer serializable types over non-serializable types
- Prefer plain js objects as namespaces (e.g. namespaces should represent a domain of functionality)
- Prefer instanced state over singletons
- Use registered JS object identity for resource and binding handles; do not add a generic ref registry, UUID reference table, or generic acquire/resolve/release operations
- Scene `on` declarations define named runtime hooks; use the independent `Events` dispatcher for generic subscriptions
- Keep namespace APIs explicit about their instance; selected Lisp forms may imply their owning app through compiler/runtime capture, without a global current-app variable or dynamically switching ownership at a call site
- Prefer few namespaces per module (a module should almost always only export a single namespace, sometimes more)
- Prefer explicit dispatch over clever runtime hacks (e.g. use tool scripts to generate large families of functions ahead of time, instead of dispatching dynamically at runtime)
- Avoid control flow in parameters (e.g. the presence of or state of a parameter should not substantially affect the behavior of the function)
- Prefer pure functions where possible
- Prefer composable types and functions over one-offs
- Prefer clamping numeric constructor inputs to their representable range; truncate integer inputs toward zero before clamping
- Keep immediate single-precision rounding for f32 values and float-vector/matrix components; f32 guards require an already representable finite value
- Standalone vectors use a canonical `__type__` tag and named `x`/`y`/`z`/`w` fields; shared packed views use explicit access functions
- Numeric values must be finite; reject NaN and infinities at language boundaries and when producing numeric results
- `(type value)` returns a dunder string for the resulting Lisp type; all scalar numbers return `"__num__"` without scalar tags
- Runtime-created texture handles carry `__type__: "__texture2d__"`; Lisp type queries and predicates use registered identity, never a dictionary's tag alone
- Booleans cannot cross the host/GPU boundary, including nested struct fields and array/many elements; shader locals and helper parameters/results may use native booleans
- Shader helpers capture live lexical bindings; pass read-only captures by copy at each call and captures that may be written by the helper or its callees by hidden WGSL pointers
- Use `App.serve` for fresh scene bindings and `App.patch` to preserve top-level data by name while replacing functions, shaders, and callbacks; skip compatible retained data initializers and reinitialize a binding if its previous value fails the new explicit type guard
- Keep resource cleanup with the resource's owner; removing or reinitializing a scene binding does not dispose its resources or transfer ownership
- Use the plain per-app `app.state` dictionary for intentionally shared data across `serve` and `patch`; preserve live value identities and make saving explicit
- Limit initial reflection to top-level scene bindings; defer block/function locals and active call frames until their contracts are discussed
- Reflection exposes live binding references; use explicit read/write operations to observe or replace a binding's current value rather than edit copied inspection entries
- Binding references follow same-name bindings across committed patches, including reinitialization; removal, fresh serving, or app disposal permanently invalidates old references
- `App.inspect` returns a plain dictionary of registered `__binding__` handles by name; `App.write` follows ordinary `set` mutability rules without reapplying initializer assertions
- Support both ordinary calls to functions returned by `App.read` and `App.call(app, reference, args)` with an explicit native list of arguments; resolve the current binding on each `App.call` without scheduling or wrapping its promise
- `App.exec` executes in the target app's live top-level environment without editing its source; new top-level bindings persist, while function/block locals keep ordinary scope, and replacement follows the existing serve/patch rules
- `App.pause` stops automatic updates/rendering while preserving bindings and resources; `App.start` resumes without paused-time catch-up, avoids duplicate loops, and preserves explicit pause across `serve` and `patch`
- Leave presentation backgrounds to the outer canvas or its parent; clear unused pixels, default runtime-created canvases to a black CSS background, and preserve supplied canvas styling
- Keep the existing WebGPU inner rendering canvas presented through the Canvas 2D outer surface
- Control presentation image smoothing with the boolean `is` configuration option, independent of `si`; default to false and reject non-booleans
- Leave supplied canvas bitmap dimensions under host control; size runtime-created canvases from CSS viewport bounds and device pixel ratio, and use bitmap pixels for presentation and automatic rendering dimensions
- Prefer native JSON encoding and decoding; decoded arrays and objects stay plain data, without automatic typed-value restoration
- Scalar constructors accept zero or one argument; omitted numeric values default to `0`, `bool` to `false`, and `str` to `""`
- Both `nil` and zero-argument `(nil)` produce JavaScript `null`
- Keep `true` and `false` as reserved literals; they cannot be rebound or shadowed
- Use `$"..."` templates and modern JavaScript string escapes for source strings and template text; keep JSON input/output strictly JSON
- Use dot notation for collection access, including parenthesized computed selectors; `(get name)` and `(get name.x)` explicitly resolve a binding or path
- Use `async` only to wrap functions and `promise` to construct and chain stages; prefer explicit `resolve` and `reject` for early stage completion, keeping `return` as an ordinary function return; nested functions can settle their lexically enclosing promise stage
- Omit the Lisp `throw` binding; `resolve` and `reject` require a lexically enclosing promise stage, including captured stages in nested functions; rejection invokes the captured callback without throwing its reason
- Caught promise failures use plain error records `{ __type__: "__error__", name, message }`, never native JS Error instances
- Functions and promise handlers implicitly return their final value expression; retain explicit `return` for early exits, and nil for empty or non-value host bodies
- Numeric strings and source literals use `:i`, `:u`, and `:f` conversion suffixes; support decimal/exponent, hexadecimal, octal, and binary forms and reject empty strings or non-finite results
- Empty lists, dictionaries, and many are false in boolean conversion and conditions; many uses active length, not capacity
- Dictionary construction requires string keys, accepting ordinary caller-evaluated expressions without implicit key conversion; it fills unmatched values with nil, accepts a list of pairs, preserves an existing dictionary's identity, and treats a single nil/undefined as empty
- Vector constructors return zeros with no arguments or a single nil/undefined and splat a single scalar number; otherwise recursively flatten lists and vectors in order, append trailing zeros for missing components, and ignore extra components












