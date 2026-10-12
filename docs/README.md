# Mercury (hg)

Mercury compiles Lisp to JavaScript and WGSL. Its runtime uses plain mutable app
data and namespace functions, with no classes or global current-app state.

```javascript
import hg from './hg/hg.js';
const app = hg.App.new({ c: 'canvas', w: 512, h: 512, si: 1, ups: 60 });
await hg.App.loadSource(app, '(on render (c) (clear 0.1 0.2 0.4))');
hg.App.dispose(app);
```

Lisp uses `App.new`, `App.loadSource`, `App.patchSource`, and `App.dispose` directly, passing app data
explicitly. Creation is synchronous; loading awaits the app's GPU initialization.
`App.loadSource` initializes fresh scene bindings; `App.patchSource` preserves top-level data
by name and replaces code definitions. Both accept source text. With no `c`, the runtime creates an owned canvas
using CSS `100dvw` by `100dvh`, without entering browser fullscreen.

Serve the repository over localhost and open `/index.html` for the vanilla staging
page: source textarea, Load source/Patch source buttons, error text, and canvas, with no custom CSS.
Expand the Inspection panels to view the active scene's compiled JavaScript body,
each Lisp shader's WGSL, and binding names, types, and current values. Compiler
bindings include their generated `$bindingN` identifiers. Inspection refreshes after
Load source/Patch source and when a panel opens; use Refresh inspection to read later changes.
Large/cyclic values have bounded previews, and host records and promises have summaries.
Failed replacements retain the working scene's compiled output.
The staging host lives in `/index.js`. `/editor.html` loads `/editor.js`
for Mayo, the composable Lisp canvas editor. Its text-proxy
operations take data explicitly through `TextProxy`; tokenization is now `App.tokenize(app, source)`.

See [composable UI and docking](./UI.md), [App API](./APP.md), [explicit storage access](./ACCESSORS.md), and
[architecture](./ARCHITECTURE.md). This is a breaking replacement of the old Aioli
runtime API. Embedded children, program exports, diagnostic delivery, and text-proxy
redesign remain deferred. CPU execution remains JavaScript; Wasm is out of scope.

## Repository layout

```text
index.html       staging entry point
index.js         staging JavaScript host
editor.html      editor entry point
editor.js        editor JavaScript host
hg/              engine, compiler, and library entry hg.js
hg/tools/        code generators and profiling scripts
hg/tests/        tests
docs/            documentation and supplied Markdown references
examples/        Lisp examples and JavaScript/HTML hosts
editor/          editor Lisp files
```

The earlier editor performance optimizations remain: incremental tokenization,
lazy snapshots, bounded invisible native editing windows, cached text rasterization,
immediate input rendering, and skipped idle GPU submission. Benchmark scripts are
in `hg/tools/`; see [measurements](./PERFORMANCE.md). Playwright/Chrome tests
use `AIOLI_URL` to select a local test server (historical test environment name).

## Graphics

The developer-supplied canvas is the **outer canvas**, using its default Canvas
2D context. The runtime creates a separate offscreen **inner canvas** for WebGPU
rendering. Shader coordinates, contexts, clear, textures, and previous-pass images
all use inner pixels. WebGPU is still required; Canvas 2D presents the completed
inner image and does not replace GPU rendering. Load source and Patch source await graphics initialization.
Unavailable WebGPU, device loss, and GPU errors are shown in the page and console.
Use localhost via `npx serve`, or HTTPS.

## Composable UI

Import `hg/ui.lisp` for persistent, editable Lisp components. Titled panes support
floating, minimize/close, dwell-confirmed split docking, all eight floating resize
grips, and dock dividers. Menu strips and the minimized-pane tray scroll
horizontally; dropdowns compose ordinary components. See [the UI API](./UI.md) and
[the complete example](../examples/ui.lisp). The rewritten editor uses that library
and `editor/code-editor.lisp`. Headless Chrome profiling covers startup, input,
typing, and dragging; see [the measured costs and remaining limits](./PERFORMANCE.md).

## Graphics operations

The first graphics binding is `clear`, accepting a single numeric scalar (RGB
splat), three RGB channels, four RGBA channels, or one `vec3f`/`vec4f`. RGB
inputs default to alpha 1. All channels must be finite numbers between zero and one.
With no arguments, `(clear)` clears to opaque black, equivalent to `(clear 0)`.

```lisp
(clear 0.1 0.2 0.4)
(clear 1) ; opaque white
(clear 0.1 0.2 0.4 0.5)
(clear (vec4 0.1 0.2 0.4 0.5))
(print "Canvas cleared")
```

The rendered image is opaque and initially black. Clear updates a color uniform and
submits a full-canvas triangle whose fragment shader returns that color.
Alpha is preserved in the output texture and `context.before` for subsequent
shader sampling, even though the displayed image is opaque. Unused outer-canvas
pixels are cleared; their visible background comes from the canvas or its parent.
The shader language below builds on this per-pixel rendering path; ray tracing
is not implemented yet. Scenes provide the animation loop. Browser services
live in `graphics.js` and supply ordinary bindings to the compiler.

## Text

`text` evaluates an ordinary Lisp body with a fresh immediate-mode text builder.
Text operations validate argument counts during compilation, including inside
render callbacks. For example, `(resolution)` reports a source-located error
before a live reload can replace the working scene; `(resolution 2)` is valid.
Literal setting values such as `(resolution 0)` are also checked at compilation.
Traced self-reloads check the candidate's first render before accepting it, so
computed invalid settings reject reload and restore the working editor.
It captures outer variables directly. Statements, `print`, `if`/`elif`/`else`,
mutation, and regular function calls work as usual. For example:

```lisp
(let name "Ada")
(let label (text
  (font "sans-serif")
  (size 32)
  (span "Hello ")
  (fill (vec3 1 0 0))
  (span name)
  (line)
  (span "Welcome back.")))
```

`span` appends a string using the current style; use `str` for explicit conversions.
Bare string statements in a `text` body are shorthand for `span`, including
interpolated strings and strings in branches, brace blocks, or captured helper
bodies. For example, `(text "Hello " (weight bold) $"{name}")` appends two spans.
Strings used as arguments, assigned to variables, or returned from functions
remain ordinary values. Use `(span value)` to append a variable or expression.
`line` appends a newline. Embedded `\n` also breaks lines, and blank/trailing lines
are preserved. `font` takes a CSS font family, `size` takes positive pixels, and
`fill` and `stroke` accept a numeric RGB splat, an RGB `vec3f`, an RGBA `vec4f`,
three RGB channels, or four RGBA channels. RGB defaults to alpha 1; all channels
must be finite numbers between zero and one. Use `nil` to disable that paint.
For example, `(fill 1)` is opaque white and `(stroke 1 0 0 0.5)` is translucent red.
`fill` replaces the former `color` operation.
Defaults are sans-serif, 16 pixels, opaque white fill, and no stroke. When both
are enabled, stroke is drawn before fill. Style changes affect all
subsequent spans, including after a branch or brace block. Earlier spans retain
their styles. Nested `text` bodies have independent builders. Functions defined
inside a text body can append to its builder while that body is executing; using
that builder after completion raises an error. Text operation names are reserved
within text bodies. Direct `return` from a text body is rejected; regular nested
functions can return normally.

Block settings are `width`, `height`, `padding`, `h-align`, `v-align`, and
`line-height`. Their final values apply to the whole block (last setting wins),
including text already appended. `h-align` accepts `left`, `center`, or `right`;
`v-align` accepts `top`, `center`, or `bottom`, as symbols or strings. Defaults are
left and top. Horizontal alignment positions each line; vertical alignment
positions the entire multiline block using its unshifted layout metrics.

`(resolution value)` controls text raster resolution separately from layout.
It also accepts `half` (0.5), `standard` (1), and `double` (2), as symbols or
strings: `(resolution double)` and `(resolution "double")` are equivalent.
It is a whole-block setting with a positive finite multiplier and default 1 (no
resampling). Values above 1 render at higher resolution then downsample, helping
fractional glyph offsets move more smoothly; values below 1 render at lower
resolution then upscale. Resampling uses smoothing. Final texture dimensions,
baseline, origin, wrapping, and alignment stay in the original pixel units;
outer-canvas presentation still uses nearest-neighbor scaling. Both final and
intermediate raster dimensions must fit the runtime's texture dimension limit.

```lisp
(text (width 640) (height 160) (resolution 4)
      (v-align center) (offset (vec2 0 0.25)) "Smooth motion")
```

`width` and `height` specify fixed texture dimensions in pixels (rounded up).
Overflow, glyph overhang, stroke, and offsets are clipped at those boundaries;
the texture origin does not move to accommodate them. Height does not change
wrapping or baseline spacing. Without a fixed dimension, that axis uses automatic
bounds including shifted glyphs and stroke padding. With no fixed height,
vertical alignment has no extra space to distribute.

`padding` accepts a nonnegative scalar for both axes or a nonnegative `vec2f`
for horizontal/vertical padding; it defaults to zero. Fixed dimensions include
padding, and wrapping/alignment use the remaining inner rectangle. For example:

```lisp
(text (width 640) (height 160) (padding (vec2 20 10))
      (h-align center) (v-align center)
      "Animated text" (offset (vec2 0 -10)) "!")
```

Fixed width wraps at whitespace across span boundaries by default; oversized words stay
intact and are clipped if they overflow. Line
height is the distance between baselines; the default uses font metrics with
20% extra spacing. Paint changes preserve shaping within contiguous spans sharing
the same font, size, weight, and italic setting. The initial layout supports left-to-right plain text and
basic whitespace wrapping; paragraph bidirectionality, Unicode line breaking,
text decorations, and editing/caret behavior are not implemented.

`(wrap false)` disables automatic wrapping while retaining explicit newlines,
blank lines, and trailing newlines. Fixed `width` and `height` then clip overflow
without changing subsequent line positions. `(wrap true)` restores the default.
This is a whole-block boolean setting; the final value applies to all spans.

```lisp
(text (font "monospace") (size 14) (line-height 20)
      (width 640) (height 400) (wrap false) (span source))
```

`(weight value)` accepts a finite numeric weight from `1` to `1000`, or a named
weight as a symbol or string. Names are `thin` (100), `extralight` (200),
`light` (300), `normal`/`regular` (400), `medium` (500), `semibold` (600),
`bold` (700), `extrabold` (800), and `black` (900). The default is 400.
`(italic)` or `(italic true)` enables italics; `(italic false)` restores upright text (the default).
Both settings affect subsequent spans and participate in measurement and rendering.
Available weights and italic faces depend on the selected font.

`(offset (vec2 x y))` visually shifts subsequent spans in pixels, without changing
their normal layout advance, wrapping, or baseline spacing. Positive y moves
down; negative y raises text. It defaults to `(vec2 0)` and accepts finite `vec2f`
values. Offsets are copied per span and included in automatic bounds, but do not
affect alignment or fixed dimensions. Explicit bounds clip overflow instead.
To offset an individual character, put it in its own span or bare string:

```lisp
(text "H" (offset (vec2 0 -5)) "i" (offset (vec2 0)) "!")
```

```lisp
(text (weight semibold) (italic true) (span "Heading")
      (weight "normal") (italic false) (span " Body"))
```

Stroke settings mirror Canvas names and defaults:

| Operation | Values | Default |
| --- | --- | --- |
| `line-width` | Positive finite width in pixels | `1` |
| `line-join` | `round`, `bevel`, `miter` | `miter` |
| `miter-limit` | Positive finite miter ratio | `10` |
| `line-cap` | `butt`, `round`, `square` | `butt` |
| `line-dash` | List or numeric array of finite nonnegative lengths | Empty (solid) |

Named options accept symbols or strings, including for `h-align`. Odd-length dash
patterns repeat twice, matching Canvas; `(line-dash (list))` restores a solid stroke.
Invalid settings raise errors. Stroke settings affect subsequent spans and are
preserved even when stroke is disabled. Text bounds include stroke padding.

```lisp
(text
  (fill nil)
  (stroke (vec3 1 0.5 0))
  (line-width 2)
  (line-join round)
  (line-cap "round")
  (line-dash (list 4 2))
  (span "Outlined")
  (fill (vec3 1))
  (stroke nil)
  (span " Filled"))
```

In the browser runtime, the result is a dictionary with `texture`, `w`, `h`,
`wh`, `baseline`, `origin`, `lines`, and `content`. `wh` is a `vec2f` containing
the text texture's width and height, available as `label.wh` in shaders too.
Inside shaders, `label.uv` is shorthand for `xy / label.wh`, using the current
pixel coordinates, including inside shader helpers. `(get label."uv")` also
works. For example, `(blend (sample label label.uv))` draws at the text texture's
natural pixel size. This shader-only property does not subtract `label.origin`.
Dimensions describe the actual raster
texture, including padding for glyph overhang and filtering. `baseline` is the
first baseline's y coordinate; `origin.x`/`origin.y` locate the layout origin
within that texture. The texture has straight RGBA alpha and belongs to the
runtime; it can be passed to `texture2d` parameters across frames and resizes.
For example, compose it over an opaque background:

```lisp
(let draw (sh (image:texture2d dimensions:vec2 position:vec2)
  (let pixel (sample image (/ (- xy position) dimensions)))
  (let background (vec3 0.1))
  (return (blend pixel (vec4 background 1)))))
(on render (context)
  (draw context label.texture (vec2 label.w label.h) (vec2 24 24)))
```

Text is a snapshot: outer mutations require evaluating `text` again. Equivalent
text snapshots reuse cached textures; the cache retains at most 128 entries
within a 32 MiB budget (a single larger entry may remain cached).
Eviction preserves textures still referenced by labels or handles. Resources are
released on runtime destruction, and evicted unreferenced textures can be collected.
For custom web fonts, load the font before creating text. Rebuilding after a font
becomes available uses its new metrics. Raster text has a fixed resolution.
`examples/text.lisp` is a complete scene.

Compiler-only callers without the browser graphics runtime receive an inspectable
dictionary with `content` and styled `runs`, with no GPU allocation. The compiler's
`textRenderer` option supplies the snapshot-to-resource adapter; Mercury supplies
its Canvas 2D rasterizer and persistent texture uploader automatically.
Run text compiler and layout checks with `node --test hg/tests/text.test.mjs`.

### Text inside shaders

`text` expressions inside `sh` are lifted into ordinary Lisp execution. Both named
and inline expressions work, and `sample` accepts the lifted text directly:

```lisp
(let name "Ada")
(let draw (sh ()
  (let label (text (size 32) (span "Hello ") (span name)))
  (let uv (/ (- xy (vec2 20 40)) (vec2 label.w label.h)))
  (return (sample label uv))))
(on render (context) (draw context))
```

`(sample (text (span "Inline")) uv)` also works. Named text exposes `.texture`,
`.w`, `.h`, `.baseline`, `.lines`, and `.origin.x`/`.origin.y` in shaders; literal
explicit `(get label.w)` lookup works too. These are read-only resource properties. Position and
transforms remain ordinary sampling-coordinate calculations. The compiler adds
hidden texture, measurement, and origin inputs automatically; shader call sites
still pass only their explicit parameters. Text aliases and shader helper access
to named text work without copying the resource.

All text expressions are evaluated once, in source order, when the `sh` expression
creates its callable value. This includes definitions in shader helpers and
conditional branches, regardless of which branches later execute on the GPU.
The text bodies capture regular Lisp values and retain ordinary text behavior,
including debugging calls and nested builders. Shader parameters, shader locals,
and per-pixel/frame builtins (`xy`, `x`, `y`, `uv`, `u`, `v`, `wh`, `w`, `h`, `t`, `dt`, `before`) are unavailable in hoisted
text; using them produces a source-located compiler error. A local declared inside
the text body may use one of those names. Outer mutations require recreating the
shader value to rebuild its text; drawing that shader repeatedly does not rebuild
the text. Existing persistent texture caching still applies to rebuilt definitions.
The complete scene is `examples/shader-text.lisp`.

## Embedding

### Async functions and promises

`(async (fn (parameters) ...body))` creates a function that returns a promise.
`(await value)` is allowed at the top level and in an async body. It waits for a promise, or passes
through an ordinary value. Functions implicitly return their final value expression;
empty or non-value bodies resolve to `nil`. Explicit `return` can exit early.
Nested regular `fn` bodies and text builders stay synchronous.
Shaders do not support promises, async, or await.

Programs containing top-level `await` have `asynchronous: true`, and `run()`
returns a promise for their result. Other programs execute synchronously.
Scene activation (`activate` or `setScene`) also returns a promise when its
initialization uses top-level `await`. The current scene keeps running until
initialization succeeds; failures leave it active, and a newer activation
supersedes an older pending activation. Pending initialization code continues
executing, but its superseded scene is never installed.

```lisp
(let calculate (async (fn (x:num)
  (let value (await (promise x)))
  (return (+ value 1)))))
(let pending (calculate 4))
```

`async` accepts exactly one function. `(async callback)` wraps a function value;
calling the wrapper produces a promise without invoking the function during wrapping.
`(promise ...body)` defers its body, adopts its normal result, and supports repeated
`then`, `catch`, and `finally` clauses in source order. An empty body resolves to nil.
`(await value)` waits for a result and never implicitly invokes a function value.

```lisp
(promise (calculate 4)
  then (value) { (resolve (* value 2)) }
  then (value) { (print value) (resolve value) }
  catch (error) { (print error.message) (return 0) }
  finally { (print "finished") })
```

`then` and `catch` accept a parameter list with zero or one parameter.
Each body is a sequence of statements up to the next chain marker, or one brace
block. `finally` takes a body without parameters. All handlers can use `await`.
A single outer brace block delimits a stage; nested braces remain ordinary scopes.

Within a promise body or handler, `(resolve value)` and `(reject reason)` explicitly
exit the current stage with fulfillment or rejection. Omitting the argument uses nil.
Resolved promises are adopted before the next stage. Prefer these explicit forms for
settlement; `return` keeps its ordinary function-return behavior, and normal completion
still supplies the returned or implicit final value. Nested functions keep their own
return boundary and capture settlement of the nearest enclosing promise stage. Calling `resolve` or `reject` there settles that
stage and exits the nested function; its caller continues normally. A nested
`promise` introduces a new settlement target. The first settlement wins, including
normal completion; later calls cannot change a completed stage.
Direct stage settlement cannot exit a text builder. Stage settlement forms require
statement position and are unsupported in shaders.

Both `resolve` and `reject` require a lexically enclosing promise body or handler,
including nested functions that capture its stage. They are invalid at top level
or in functions defined outside a promise. `(reject)` invokes the captured rejection
callback with nil. Use `(promise (reject reason))` to construct a rejected promise;
ordinary `return` retains its existing function-return behavior.

Thrown errors reject the chain. A normally completing `catch` recovers; `reject`
propagates failure. `finally` preserves the previous result or rejection on successful
cleanup, including explicit `resolve` or ordinary `return`; rejected cleanup replaces
that outcome. Catch arguments are custom error records:
`{ __type__: "__error__", name: "Error", message: "oops" }`.
Native JS errors are converted to these plain records, preserving their name and
message. Other reasons use name `"Error"` and their existing string conversion.
Rejecting an existing error record preserves its identity. Use `(reason:error)` for
a handler parameter, `(value : error)` for an assertion, or `(error? value)` to query.
Error records support named/computed field access, copying, equality, and native
JSON serialization. `name` and `message` accept string writes through language access;
the tag is retained. JSON decoding still returns an ordinary dictionary.
There is no Lisp `throw` binding. `(reject error)` propagates a caught error
through rejection, preserving the custom record. Native failures still propagate
through promises and `await`; catch converts them to the agreed error record.

`async?` checks whether a value is a promise; an async function itself is not a
promise until called. `async-all` and `async-race` accept a list of promises
and/or values. `async-all` resolves to a result list in input order and rejects
if any item rejects. `async-race` adopts the first fulfillment or rejection;
it does not wait for the first successful result. Neither cancels remaining
operations. An empty `async-all` resolves to an empty list, while an empty
`async-race` remains pending.

```lisp
(let pending (async-all (list (import "./a.lisp") (import "./b.lisp"))))
(print (async? pending)) ; true
(let modules (await pending))
```

Use `(promise (resolve value))` to produce a fulfilled promise and
`(promise (reject "message"))` to produce a rejected promise. Body evaluation
is deferred.
Use the `then`, `catch`, and `finally` stages of `promise` for chaining;
the former `promise-*` helper bindings remain removed. Promises can be stored
in dictionaries and lists or asserted with the `promise` type.

Async scene callbacks use an explicit async function body:

Scene `on` accepts an explicit `fn`, an `async`-wrapped `fn`, or a function variable/
dictionary field. For example, `(on keydown (fn (event) ...body))` or
`(on keydown handler)`. The original `(on keydown (event) ...body)` shorthand
also works. Function bindings are captured when the scene is initialized;
reassigning the variable later does not replace the registered callback.
The same parameter limits and synchronous update/render restriction apply to
function variables and inline declarations.

In value position, nested `(on click (event) ...body)` calls the in-scope `ui-on`
Lisp constructor to produce a component handler. It does not register a scene
hook. See [nested handlers](./UI.md#nested-on-and-ordinary-functions).

```lisp
(on attach (async (fn ()
  (set value (await (calculate 4))))))
(on keydown (async (fn (event)
  (set value (await (calculate value))))))
```

Async `attach` delays the scene loop until it resolves. Async input callbacks
do not block animation; their rejected results are reported through `onError`
and stop the current scene. Async resize/detach callbacks are also supported;
resize does not delay rendering, and detach cleanup does not delay replacement.
`update` and `render` declarations remain synchronous because render contexts
are valid only during their frame. Return a promise from a callback if the
runtime should observe its rejection, or handle it explicitly with `catch`.
Scene replacement ignores stale attach completions and callback failures, but
does not cancel arbitrary async work or its side effects on shared host objects.

### Outer and inner canvases

Create an app with optional rendering dimensions and scale increment:

```javascript
import hg from '../hg/hg.js';
const app = hg.App.new({ c: outerCanvas, w: 320, h: 180, si: 1 });
await hg.App.loadSource(app, source);
app.w = 640; app.h = 360; app.si = 0.5; // consumed at the next frame boundary
```

The runtime owns the inner rendering buffer. Supplied outer canvases retain their
host-controlled `width` and `height`; CSS resizing alone does not change their
bitmap or rendering resolution. The host handles its own bitmap sizing, including
any desired device pixel ratio scaling. Runtime-created outer canvases follow
their CSS viewport bounds multiplied by device pixel ratio, rounded to positive
bitmap dimensions. Resize observation and frame preparation keep owned canvases
in sync and observe host bitmap changes. Rendering `width` and `height` default
independently to the destination bitmap. Set either to `null` to resume following
that bitmap dimension.
The inner image is centered and scaled uniformly to fit. A positive `scaleStep`
snaps the fit scale down to a multiple of that increment: 1 gives integer scales,
0.5 gives half-step scales. When no increment fits, the minimum increment is kept
and the image is cropped symmetrically. Zero or `null` disables scale snapping.
The outer canvas clears unused pixels. Boolean `is` controls image smoothing
independently of `si`: its default `false` uses nearest-neighbor drawing, and
`true` enables smoothing. Filters remain disabled. Set it at creation with
`hg.App.new({ c: outerCanvas, is: true })` or edit `app.is` for the next frame.
Runtime-created canvases default to a black
CSS background. Supplied canvases keep their background styling and can be
transparent so their parent's background shows through. Control the displayed size through layout
or CSS; hosts supplying a canvas also maintain its bitmap attributes.
Explicit inner dimensions still control the logical rendering resolution.

Regular Lisp can change configuration from anywhere; no dedicated configuration
callback is required. `configure` accepts a dictionary or key/value pairs;
keys in the pair form can be symbols or strings. `(configure)` leaves the
configuration unchanged and returns the requested settings:

```lisp
(configure w 320 h 180 scale-step 1 ups 120)
(configure (dict "w" 320 "h" 180 "scale-step" 1 "ups" 120)) ; equivalent dictionary form
(configure (dict "w" nil)) ; width follows the outer canvas again
(configure is true) ; enable presentation smoothing at any scale increment
(configure (dict "is" false)) ; use nearest-neighbor presentation again
(let view (canvas))
```

`ups` sets updates per second (default 60) and must be a positive finite number.
It can also be passed as `hg.App.new({ c: canvas, ups: 120 })`. Rendering always follows
the browser's animation frames. Update time accumulates, including unfinished
catch-up work; changing `ups` preserves this backlog and takes effect on the
next frame. `(configure)` includes the requested `ups`.
`is` accepts only booleans and defaults to `false`; `(configure)` includes its
requested value. A smoothing-only change presents the existing image again,
without resizing the GPU buffer or resetting feedback textures.

Configuration changes apply at the next frame boundary, before updates/rendering
or a standalone `clear`. A change during a shader/render callback leaves that
callback's dimensions unchanged. `(canvas)` returns the applied canvas size:
`w`, `h`, and `wh`. Lisp operates in canvas coordinates. Presentation layout and
coordinate conversion are managed by the runtime. Internal JS integrations use
`InnerCanvas.layout(app.display)`, `InnerCanvas.toInner(app.display, x, y)`, and
`InnerCanvas.toOuter(app.display, x, y)` in bitmap pixels. Input and native caret
positioning convert between bitmap and CSS coordinates.

```lisp
(on resize (event)
  (print event.wh event.old-wh))
```

`resize` fires after an applied inner width or height change and before the
next update/render callback. Its dictionary contains `w`, `h`, `wh`, `old-w`,
`old-h`, and `old-wh`. It covers configured size changes and outer resizes
that affect an automatic inner dimension. A supplied canvas's CSS resize alone
does not fire it. Initial attachment, scale changes,
and outer resizes with fixed inner dimensions do not fire it. A inner
resize resets `before` to opaque black and reallocates render textures; changes
to presentation scale alone preserve the inner image and feedback textures.

All input listeners stay attached to the outer canvas. Pointer `x`, `y`, `xy`,
and `uv` use inner coordinates. Events in letterbox areas still fire, with
negative/out-of-range coordinates and `inside: false`. Pointer queries reproject their last position
using the current applied layout, even if no new movement has occurred.

Scenes support keyboard, pointer (mouse, touch, pen), wheel, and gamepad input.
Input callbacks use the same `(on name (event) ...)` syntax; the optional event
parameter is a dictionary. State is updated before the callback runs. Queries
return independent snapshots, so changing a returned value does not change input.

```lisp
(on keydown (event)
  (if (not event.repeat) (print event.code)))
(on pointerdown (event) (print event.xy))
(on joydown (event) (print event.index event.button))
(on update (context)
  (if (key? "KeyW") (print "moving forward"))
  (let cursor (pointer))
  (let pad (joy 0))
  (if pad (print pad.axes.0)))
```

| Callbacks | Event fields |
| --- | --- |
| `keydown`, `keyup` | `code` (physical key, e.g. `KeyW`), `key`, `repeat`, `alt`, `ctrl`, `shift`, `meta`, mutable `prevent-default` |
| `pointerdown`, `pointerup`, `pointermove`, `pointercancel`, `pointerenter`, `pointerleave` | `id`, `type` (`mouse`/`touch`/`pen`), `primary`, inner `x`, `y`, `xy`, `uv`, `inside`, `button`, `buttons`, `pressure`, modifier booleans |
| `wheel` | `dx`, `dy`, `dz`, `mode` (browser delta units), inner-pixel `x`/`y`, `inside`, modifier booleans, mutable `prevent-default` |
| `joyconnected`, `joydisconnected` | Gamepad snapshot: `index`, `id`, `mapping`, `connected`, `timestamp`, `axes`, `buttons` |
| `joydown`, `joyup` | `index`, `button`, `value`, `pressed` |
| `joyaxis` | `index`, `axis`, `value` |

`(key? "KeyW")` queries physical keyboard codes. Keyboard input is scoped
to the focused canvas, which becomes focusable and receives focus on pointer down.
Key releases are tracked outside the canvas too. While focused, the canvas
prevents scrolling from Space, arrows, PageUp/PageDown, and Home/End on both
key press and release, including repeats. Tab navigation and Ctrl/Meta/Alt
shortcuts retain browser behavior. Use CSS `touch-action: none` when touch gestures should
control the scene instead of scrolling or zooming.
The canvas suppresses the browser context menu so right-click remains available
for pointer input; destroying the runtime removes this handler.

`(cursor "ew-resize")` sets the owning canvas's CSS cursor; `(cursor nil)` releases
the override and restores its previous inline cursor. Disposal also releases it.
Cursor choices for UI edges, corners, dividers, buttons, and text are implemented
in [the ordinary Lisp UI library](./UI.md), using the same resize hit regions as
pointer-down handling.

`(pointer? mask)` tests the primary pointer's button mask; `(pointer? mask id)`
selects a pointer. Masks are left/contact 1, right 2, middle 4, back 8, and
forward 16. Combined masks require all selected buttons: `(pointer? 3)` tests
left and right together. Masks must be positive 32-bit integers.
`(joy? button)` tests a button on gamepad index 0; `(joy? button index)`
selects a gamepad. It uses the browser button's `pressed` flag. Missing devices
and unavailable gamepad buttons return `false`. For example, `(joy? 0 2)`
tests button 0 on gamepad 2. Both functions return booleans like `key?`.

`(pointer)` returns the primary pointer, `(pointer id)` selects an id, and
`(pointers)` lists tracked pointers. Missing pointers return `nil`. Positions use
inner canvas pixels, accounting for CSS scaling and presentation offset/scale;
`uv` is `xy / inner dimensions`.

In shaders, `(sample image)` defaults to the image's magic `uv` (`xy / image.wh`),
for both textures and hoisted text. `(sample image coordinates)` supplies explicit
`vec2f` coordinates. This draws an image at its natural pixel size by default;
use `(sample image uv)` to stretch it across the inner canvas.
`buttons` is the browser button bitmask. Pointer down captures the pointer so
drags continue outside the canvas. Finished touches, canceled pointers, and
uncaptured pointers leaving the canvas are removed; mouse hover state remains
while inside the canvas.

`(joy index)` returns a connected device or `nil`; `(joys)` lists connected
devices while preserving each browser index. Axes are numeric lists; buttons are
lists of dictionaries containing `pressed`, `touched`, and `value`. Gamepads are
polled before each animation frame's updates and render; callbacks report
connections and state transitions. Browser support, secure-context requirements,
and user interaction determine which devices are exposed. No dead zone is applied.

Blur, hidden documents, and scene replacement reset tracked input; gamepads are
rediscovered on the next visible frame. Runtime destruction removes listeners
and releases pointer capture. Input callback failures stop animation and report
through `onError`; activating a scene enables callbacks again.

The editor is a consumer of Mercury. Import `hg/hg.js` and supply app data to
namespace functions:

```html
<canvas id="demo" width="320" height="240"></canvas>
<script type="module">
  import hg from '../hg/hg.js';
  const app = hg.App.new({ c: 'demo' });
  const url = new URL('./examples/blue.lisp', location.href);
  await hg.App.load(app, url.href);
</script>
```

Each app owns its graphics, input, clock, and module cache. `hg.App.dispose(app)`
releases resources; only runtime-created canvases are removed. One app may own a
given presentation canvas at a time. Compiler/orchestration helpers live internally
in `hg/` and are not a parallel legacy runtime API.

Loops are statement forms in regular code and shaders:

`<`, `>`, `<=`, and `>=` accept exactly two numeric scalars and return a boolean,
in regular code and shaders. Shader operands must share a scalar type (`f32`,
`i32`, or `u32`); convert explicitly when needed. For example,
`(while (< i 10) (set i (+ i 1)))`. Vectors, matrices, and nonnumeric values
are rejected. Regular-code numeric operands must be finite.

Math functions work in regular code and shaders: `min` and `max` take two
operands, `clamp` takes `(value minimum maximum)`, and `sin`, `cos`, `tan`,
`asin`, `acos`, `atan`, and `sqrt` take one operand. Trig angles use radians.
They accept numeric scalars or operate component-wise on matching vectors;
`min`, `max`, and `clamp` broadcast scalars to a vector's dimension. Trig and
square root require float vectors in either compiler, and float scalars in shaders.
Shader operands must share a scalar family. `clamp` requires minimum <= maximum.

```lisp
(let wave (sin t))
(let bounded (clamp (vec3 -1 0.5 2) 0 1)) ; vec3 0 0.5 1
```

```lisp
(while condition
  ...body)
(until condition
  ...body)
(for i 1..10
  (print i)) ; regular code: 1 through 9
(for i 10..1
  (print i)) ; 10 through 2
(for i count
  (print i)) ; 0 through count - 1
(for item collection
  ...body)
```

`while` re-evaluates its condition before each iteration using ordinary condition
truthiness. `until` runs while its condition is false, using the same truthiness
rules. `for` with a range evaluates its bounds once, from left to right, excludes the end,
and steps by 1 when ascending or -1 when descending. Equal endpoints run zero
iterations. Counts must be nonnegative; endpoints must be finite safe integers
in regular code. Ranges are syntax, not values, and only work as `for` inputs.
Endpoints can be variables, field accesses, or expressions, for example
`(for i (+ start 1)..(- end 1) ...body)`. Keep `..` adjacent to the left endpoint.

`for` evaluates its collection once and binds each element in order. It accepts
lists, arrays, and `many` in regular code; shaders accept arrays and `many`,
including storage inputs. The initial elements are selected before iterating;
adding or removing items does not extend the loop. Regular object elements retain
their usual reference semantics. Shader collection iteration expands to indexed
WGSL loops. Each iteration has a fresh scope; loop bindings are local to the body.
Assigning an `for` range binding does not change its private loop counter.

`(break)` exits the innermost loop and `(continue)` starts its next iteration.
Both require statement position within a loop in the same function; nested
functions and text builders cannot control an enclosing loop. Bodies may use
brace blocks and ordinary nested loops. Returns inside loops return from the
containing function; shader return analysis still requires an explicit return
after a potentially empty loop.

Shader `for` range and count bindings are f32 values. Bounds must be integers within ±16777216
so unit steps remain exact. Invalid literal bounds fail compilation; invalid
dynamic bounds skip the loop. Neither compiler imposes an iteration limit.

| Field | Update context | Render context |
|---|---|---|
| `t` | Accumulated simulation time at the end of this fixed step | Elapsed frame time since scene activation |
| `dt` | Fixed `1 / ups` seconds | Actual elapsed seconds since the previous frame |
| `w`, `h` | Current inner canvas dimensions in pixels | Inner dimensions of this render frame |
| `before` | Absent (`nil` on access) | Latest shader output in this callback; last completed frame before the first draw, or opaque black initially/after resize |

The first render has t/dt = 0 and no update. A bounded catch-up can leave simulation
time behind render time. Both clocks reset on scene replacement. Contexts are
ordinary dictionaries: dot access, explicit `(get context.t)`, and `copy` work. Each invocation gets a
new snapshot. Mutating timing/dimension fields does not change the scheduler,
canvas, or numeric shader builtins. Copies, update contexts, and saved render contexts cannot
authorize shader calls in another frame.
Elapsed frame time accumulates, and every update receives
exactly `1 / ups` seconds. Fractional time carries into subsequent frames.
`maxUpdatesPerFrame` defaults to 8 to bound catch-up work; excess accumulated time
is retained rather than discarded, so a long gap between browser frames can
produce a backlog. Explicit `App.pause(app)` discards the backlog and stops
automatic updates/rendering while preserving scene data and resources.
`App.start(app)` resumes without catching up paused time and repeated starts
do not add loops. The explicit paused state survives `load` and `patch`;
reflection and explicit function calls remain available. See
[pausing and starting](./APP.md#pausing-and-starting).

Compilation and top-level evaluation finish before detaching the old scene.
Failures in those stages leave its loop active, but top-level host effects are
not rolled back. Lifecycle failures stop the transition or loop; callback side
effects are not rolled back. Failed attach attempts invoke detach for cleanup.
Frame errors stop scheduling to avoid repeated errors. Asynchronous source loads
use latest-request-wins activation.

`hg.App.loadSource(app, source)` compiles and replaces the app scene, awaiting graphics
initialization and checking the candidate when trace is enabled. Standalone
compiler execution is internal to this staging pass.

`hg.App.patchSource(app, source)` performs the same replacement while preserving
top-level data bindings by name. It skips retained initializers, initializes new
names, omits removed names, and refreshes function/shader definitions and callbacks.
Local bindings are not preserved. A retained value that fails the binding's new
explicit type guard causes its new initializer to run; the replacement must pass
the guard. Compatible and unannotated data remain preserved.
`hg.App.load(app, url)` fetches source and starts fresh bindings;
`hg.App.patch(app, url)` fetches source and preserves compatible top-level data.
All four operations share readiness, candidate validation, and latest-request-wins
activation, and return promises resolving to the app. The fetched URL establishes
the scene's origin for relative imports and loads.
All four operations retain `app.state` and app-owned resources. Use the plain `app.state`
dictionary for intentionally shared data across fresh scenes. JS and Lisp share
its live values; separate apps start with separate dictionaries. Saving is explicit.
See [loading and patching](./APP.md#loading-and-patching).

`App.inspect(app)` returns a plain dictionary of live top-level binding handles
keyed by name. `App.read(app, handle)` returns a binding's current value;
`App.write(app, handle, value)` follows ordinary `set` mutability rules, without
reapplying initializer assertions. These synchronous operations do not save or
change source initializers. Handles follow committed patches, including
reinitialization, but removal, fresh loading, and disposal invalidate them.
See [live binding reflection](./APP.md#live-binding-reflection).

Functions returned by `App.read` can be called normally. Alternatively,
`App.call(app, handle, args)` resolves the current function and invokes it with a
native argument list, retaining its normal parameter checks, result, and promise
identity. Calls execute immediately without starting/resuming scheduled updates.
Calls through handles follow patched function definitions; a saved function value
remains that particular function.

`App.exec(app, source)` runs Lisp in the app's active top-level environment without
editing its source. Existing bindings are shared live; new top-level `let` and
`struct` bindings persist and appear in inspection. Later injections can use them.
Wrap a command in a function for temporary locals. Duplicate declarations remain
errors; use `set` to update an existing mutable binding. Execution returns its final
value (a promise when using top-level `await`), works while paused, and leaves completed
effects in place if a later statement fails. Injected names absent from replacement
source are removed by `patch`; `load` starts fresh.
See [top-level execution](./APP.md#top-level-execution).

### Generic events and scene hooks

Scene `(on render ...)`, `(on update ...)`, and other `on` declarations define named
runtime hooks. Runtime services invoke them directly. Generic communication uses
independent dispatchers:

```lisp
(let events (Events.new))
(let handler (Events.on events "changed" (fn (value) { (print value) })))
(Events.emit events "changed" 42)
(Events.off events "changed" handler)
```

Handlers run synchronously in registration order. Emissions snapshot subscribers;
nested emissions queue behind the current emission. Duplicate registration of the
same handler is harmless. A synchronous callback error discards queued emissions
and propagates, leaving the dispatcher reusable. See [Events](./EVENTS.md).

`(pause)`, `(start)`, `(load-source source)`, `(patch-source source)`, `(load url)`,
`(patch url)`, and `(exec source)`
operate on the app that owns their compiled code. They are ordinary callable
bindings, including in modules, nested functions, and async continuations.
`load-source`/`patch-source` also accept optional source options. URL shorthand
resolves relative paths against the program that defined it, including in saved
functions and modules. Namespace operations continue to accept explicit instances.
The previous `serve` and `set-scene` bindings are removed.
Further shorthand remains deferred. See
[current-instance Lisp forms](./APP.md#current-instance-lisp-forms).

### Imports and scene paths

`import` is a runtime function returning a promise for a module namespace.
Use `await` at the top level or inside an async function; the path can be
computed dynamically. No `export` or `scene` declaration is required.

```lisp
; lib/math.lisp
(let multiplier 2)
(let multiply (fn (value)
  (return (* value multiplier))))
```

```lisp
(let math (await (import "./lib/math.lisp")))
(print (math.multiply 3)) ; 6
(set math.multiplier 4)
(print (math.multiply 3)) ; 12
(set math.multiply (fn (value) (return (+ value 1))))
```

The namespace is a dictionary exposing every top-level `let` and `struct`
binding, plus declared callbacks. Its members are writable, and assignments
update the actual bindings used by functions inside the module. New dictionary
members can also be added. Existing lexical scopes still apply: function
parameters and nested block locals belong to those scopes. Host builtins are
available to module code but are not copied into its namespace. If a callback
and an explicit top-level binding share a name, the explicit binding occupies
that namespace member. Importing callbacks does not activate a scene.

Within a runtime, imports of the same resolved URL share one initialization,
namespace, and state, including concurrent imports. Module initialization can
use top-level `await`. Separate runtimes have separate module caches and state;
the same mutable host value explicitly supplied to both runtimes through
`bindings` remains shared. A saved function value continues to reference that
function after its namespace member is replaced. Local duplicate declarations
remain errors; separate namespaces can contain the same member names without
conflicting. An import used as a standalone statement merges its members into
the current lexical scope:

```lisp
(await (import "./examples/library.lisp"))
(test)
```

When the import is used as a value, such as in `(let library (await (import
"./examples/library.lisp")))`, it stays namespaced. Merged names remain live:
`(set test replacement)` patches the original module binding. A module can
also expose bindings from its own standalone imports. Reimporting the same
namespace is harmless; collisions with local declarations, builtins, reserved
forms, or a different imported namespace reject the merge before any names are
added. Use a namespaced import to resolve a collision. Nested imports belong to
their block/function scope. `await` is still required to use imported names in
subsequent statements; an unawaited standalone import merges only when its
promise resolves. Unknown merged names report runtime Lisp traces.

```lisp
(await (load "./scenes/menu.lisp"))
```

`load` fetches a script as a scene, waits for its initialization, and installs
its callbacks. All callbacks are optional; a script with none simply runs its
initialization and stays idle. `load` starts fresh scene bindings; `patch` preserves
compatible top-level data. Imported modules stay shared. Both use the same candidate
validation as their source-text counterparts. The existing scene keeps running during loading;
failed loads leave it active, and newer activation requests supersede older
ones. Superseded initialization is not cancelled and its effects are not rolled
back. JavaScript hosts use `hg.App.load`/`hg.App.patch` for URLs and
`hg.App.loadSource`/`hg.App.patchSource` for text. Input kind follows the operation
name rather than being guessed from string contents.

Paths follow URL resolution: relative paths resolve against the importing
script's URL, absolute URLs and root-relative paths are supported, and queries
identify distinct modules. Fragments are ignored. Paths are exact: there is no
extension guessing, directory search, or package-name resolver. The default
base URL is the document's base URI. Pass `{ sourceURL: ... }` as the third argument to `hg.App.loadSource` to establish
the source origin.
Imports inside a function retain the URL of the script that defined it.

Fetch, compile, and initialization failures reject the import promise; failed
modules can be retried. Circular initialization dependencies reject with their
URL chain. Destroying a runtime discards its module cache and prevents pending
loads from being initialized or installed. The runtime's optional `fetch`
constructor setting can supply a custom fetch-compatible source loader.
Callbacks are synchronous. Run checks with
`node --test hg/tests/compiler.test.mjs hg/tests/scheduler.test.mjs hg/tests/shader.test.mjs hg/tests/types.test.mjs hg/tests/data.test.mjs hg/tests/graphics.test.mjs hg/tests/swizzle.test.mjs hg/tests/access.test.mjs hg/tests/logical.test.mjs hg/tests/nil.test.mjs hg/tests/truthiness.test.mjs hg/tests/selectors.test.mjs hg/tests/conversions.test.mjs hg/tests/structs.test.mjs hg/tests/bool-structs.test.mjs hg/tests/numeric-types.test.mjs hg/tests/arrays.test.mjs hg/tests/many.test.mjs hg/tests/cap.test.mjs hg/tests/matrix-access.test.mjs hg/tests/matrix-names.test.mjs hg/tests/type-aliases.test.mjs hg/tests/constructors.test.mjs hg/tests/transforms.test.mjs hg/tests/shader-conditionals.test.mjs`.

Swizzle reads and writes use checked-in generated accessors in
`hg/swizzles.generated.js`. Regenerate them with
`node hg/tools/generate-swizzles.mjs`; verify the file is current with
`node hg/tools/generate-swizzles.mjs --check`. Generation covers every valid
one-to-four component selector for all vector dimensions and numeric families.
Writable selectors contain distinct components. Runtime access validates the
target and replacement, then calls the accessor with explicit component indices;
multi-component reads keep fresh storage and writes snapshot replacements first.

Vector arithmetic also uses checked-in generated operations in
`hg/arithmetic.generated.js`. Regenerate with
`node hg/tools/generate-arithmetic.mjs`, or verify with `--check`. Operations cover
all vector types and both scalar broadcast directions, with explicit component
expressions after operand validation. Integer wrapping, zero-division errors,
and float rounding between successive operations are preserved. Numeric type
metadata and struct field indexes are prepared once and reused.

## Shader Lisp

`sh` enters a separate compiler that emits WGSL, not JavaScript. The first subset
supports numeric literals, `let`, `set`, brace scopes, explicit `return`, arithmetic
`+ - * / %`, boolean literals and `and`/`or`/`not`, `vec2f`, `vec3f`, `vec4f`, square `mat2x2f`, `mat3x3f`, `mat4x4f`, `copy`, and vector
dot access such as `xy.x`, `xy.yx`, and `(vec4f 1).wwww`. A shader must return a
vec4f RGBA color. Locals are mutable and types are inferred from initializers;
assignment must preserve their type. There are no implicit scene-variable captures.

```lisp
(on render (context)
  ((sh ()
    (let uv (/ xy (vec2f w h)))
    (return (vec4f uv 0 1))) context))
```

Built-in inputs are available in every shader and shader helper:

| Input | Type | Value |
| --- | --- | --- |
| `xy` | vec2f | Pixel-center coordinates, origin at the top left |
| `x`, `y` | f32 | Components of `xy` |
| `uv` | vec2f | Normalized coordinates: `xy / wh` |
| `u`, `v` | f32 | Components of `uv` |
| `wh` | vec2f | Current output dimensions in pixels |
| `w`, `h` | f32 | Components of `wh` |
| `t`, `dt` | f32 | Elapsed scene-render time and time since the previous frame |
| `before` | texture2d | The image preceding this shader call (`context.before`) |

Times are in seconds and start at zero. Pixel centers start at `(0.5, 0.5)`;
normalized coordinates use those centers and increase downward along v.
Dimensions and time come from the current frame, including after resizing.
The old `p` input has been removed. Builtins cannot be assigned or declared as
shader input parameters; local bindings and helper parameters can shadow them.

`before` is supplied automatically when a shader references it, including inside
helpers. It starts as the last completed frame, then advances to each shader's
returned texture after that call. `clear` also advances it to the cleared image.
Shaders called in sequence therefore receive the preceding call's output.
The first frame and the first frame
after a resize receive an opaque black texture of the current output dimensions.
Frames with no draws retain the displayed image; synchronous render failures
discard recorded passes and retain the last completed image. There is no extra
shader argument to pass:

```lisp
(let fade (sh ()
  (let image (sample before uv))
  (return (vec4 (* image.xyz 0.98) 1))))
(on render (context) (fade context))
```

Regular code can pass `context.before` to explicit `texture2d` parameters instead.
Runtime-created texture handles carry `__type__: '__texture2d__'`. In regular code,
`(type image)` returns `"__texture2d__"`, `(texture2d? image)` returns true, and
`image.__type__` or `(get image.__type__)` reads the marker. Textures are resource
handles, so `dict?` returns false and JSON encoding rejects them. A plain dictionary
with the same marker remains a dictionary, not a usable texture.
Textures expose read-only `w` and `h` pixel dimensions and `wh` as a `vec2f`,
in regular code and shaders: `image.w`, `image.h`, `image.wh`, or
`(get image."wh")`. This includes shader outputs, `context.before`, and text
textures such as `label.texture.wh`. Each regular-code `wh` read returns a fresh vector.
Inside shaders, textures also expose `image.uv`, equivalent to `xy / image.wh`.
It uses the current pixel coordinates even inside helpers or when a local `uv`
variable exists. `(get image."uv")` also works. For example,
`(blend (sample image image.uv))` draws a passed text texture at its natural pixel size.
It is a borrowed handle belonging to this runtime's current render frame; saving
it and using it in a later frame is rejected. Earlier passes in the current
callback remain available through the textures those shader calls return.
Save the initial `context.before` in a local variable before drawing if you need
to sample the previous frame throughout the callback.

`(blend foreground background)` composites straight-alpha colors,
placing the first over the second. It returns a fresh straight-alpha `vec4f`,
including the combined alpha when the background is translucent. Two fully
transparent colors produce `(vec4 0)`. Alpha is clamped to zero through one;
RGB values are preserved without clamping. The two-color form works in regular
Lisp and shaders; regular colors must have finite components. In shaders, with
one argument the background defaults to `before`: the output of the preceding
shader or `clear`, or the last completed frame before the first draw.
In regular code, which has no render context, the one-color form defaults to
opaque black `(vec4 0 0 0 1)`.

In shaders, either argument can be a `vec4f` color, `texture2d`, or hoisted text.
Textures and text are sampled at the current screen UV, including inside helpers;
a local variable named `uv` does not override those coordinates. To use custom
coordinates, pass an explicit `sample` result. Regular code accepts colors only,
since it has no current pixel coordinates for texture sampling:

```lisp
(sh ()
  (let label (text (size 72) (fill (vec4 1 0 0 1)) (span "Hello World")))
  (let text-uv (/ (- xy (vec2 20 20)) (vec2 label.w label.h)))
  (return (blend (sample label text-uv))))
```

Pass a second argument to choose the background, for example `(blend color image)`
or `(blend foreground-texture background-texture)`. Use `(blend color before)`
explicitly for compositing over the current incoming image, including the output
of an earlier shader or `clear` in the same callback.

Numbers in shaders are f32, not the scene language's JavaScript numbers. Finite
f32 literals are supported; explicit NaN/Infinity constants are not implemented
in this subset. Scalar/vector arithmetic explicitly broadcasts the scalar;
different vector dimensions are rejected. Vector constructors accept the required
total components (including vector arguments), or one scalar to repeat.

Shaders are callable values with the render context first, followed by uniforms.
Shader parameters declare their types with colons. Numeric uniforms support
`f32`, `i32`, `u32`, all nine vector types, `mat2x2f`, `mat3x3f`, and `mat4x4f`;
resource parameters support `texture2d` and numeric packed collections. Boolean
parameters and nested boolean fields/elements cannot cross the host/GPU boundary:

```lisp
(let tint (sh (gain:f32)
  (let uv (/ xy (vec2f w h)))
  (return (vec4f (* uv gain) 0 1))))
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
the output textures. Typed storage buffers are described below; additional
render-target controls and uniform/resource types are future additions.

Pass an earlier shader output into a texture parameter to compose passes:

```lisp
(let gradient (sh ()
  (return (vec4f (/ xy (vec2f w h)) 0.4 1))))
(let tint (sh (image : texture2d color : vec4f)
  (return (* (sample image (/ xy (vec2f w h))) color))))
(on render (context)
  (tint context (gradient context) (vec4f 0.5 1 0.25 1)))
```

`sample` reads normalized UV coordinates with linear filtering, clamp-to-edge,
and mip level zero. Each pass has separate input and output textures. Resource
handles must come from the same runtime's current frame; stale handles and handles
from other canvases are rejected. Scene `vec2f`, `vec3f`, and `vec4f` bindings construct
numeric vectors for uniform arguments. Vectors retain their declared dimensions;
GPU numeric inputs must be finite f32 values. Uniforms and textures follow the
declared parameter order and reuse the shader pipeline. See `examples/composition.lisp`.

Shader helpers use the same `let` and anonymous `fn` structure as scene code:

```lisp
(sh ()
  (let gradient (fn (uv:vec2f)
    (return (vec4f uv 0 1))))
  (return (gradient (/ xy (vec2f w h)))))
```

The compiler recognizes a `let` initialized with `fn` and lifts the function to
WGSL module scope. The binding is a static reference, not a GPU variable holding
a function. Calls compile directly to the lifted helper; no named-fn variant is
needed. Helper parameter types are `bool`, `f32`, `vec2f`, `vec3f`, `vec4f`, `mat2x2f`, `mat3x3f`,
`mat4x4f`, or `texture2d`. Returns are inferred from explicit returns or a final value expression, producing a boolean, scalar,
vector, or matrix; only the outer shader must return vec4f. Numeric parameters
remain mutable through generated local copies; texture
parameters are GPU resource inputs and cannot be assigned.

Helpers can call other helpers and contain nested let-bound helpers. Generated
names preserve lexical scope and shadowing after lifting. Built-in shader inputs
and declared uniforms remain accessible; pixel position is passed automatically.

Shader helpers capture outer shader locals and helper parameters by their lexical
binding, including through nested helper calls. Each call passes the current value
by copy when the helper and its callees only read it. If any path can write the
binding, the compiler passes a hidden `ptr<function, T>` instead; field/component
writes and bounded many edits count as writes to the captured variable. Later reads
and the caller observe those writes. Shadowed names retain distinct bindings.
Lazy `and`/`or` operands retain the same rules and short-circuit behavior.

```lisp
(sh ()
  (let gain 0.25)
  (let shade (fn () (vec4f gain)))
  (let brighten (fn () (set gain 0.75)))
  (brighten)
  (shade))
```

Here `brighten` receives a pointer to `gain`; `shade` receives its current value
by copy and returns four `0.75` components. Helper calls may also be statements
whose results are discarded. Explicit parameters still pass by value; a nested
helper can capture the outer helper's mutable parameter copy. Reading a binding
before its initialization remains a compile error. Scene variables still require
explicit shader inputs, and helpers still require a typed result on every path.
Recursive cycles, argument type/arity mismatches, reassignment of helpers, and
using function references as data are compile errors. Anonymous helper calls and
function aliases are not implemented: bind each shader fn directly using let.
See [shader captures](../examples/shader-captures.lisp) for a complete scene.

Colon annotations allow whitespace on either side: `uv:vec2f`, `uv: vec2f`,
`uv :vec2f`, and `uv : vec2f` are identical. Newlines and comments are allowed too.
Parameters are a flat sequence of name, colon, type; commas and the old nested
`(name type)` notation are not used. Missing/extra colons and unsupported types
produce Lisp source traces. Colon is a dedicated reader token and cannot
occur inside ordinary symbol names; strings and comments are unaffected. Scene
`fn` and lifecycle callbacks can use optional annotations as described below.

Shaders support the same statement-position `if`/`elif`/`else` branch syntax as
regular code. `else` is optional; each branch creates a lexical scope, and only
the first matching branch executes. Conditions use language truthiness for
supported shader values, including zero scalar numbers being false:

```lisp
(sh (input:f32)
  (let enabled (bool input))
  (if enabled {
    (return (vec4f 1 0 0 1))
  } elif 0 {
    (return (vec4f 0 1 0 1))
  } else {
    (return (vec4f 0 0 1 1))
  }))
```

Every shader/helper path must return a value, and return types must agree across
all paths. An if without a returning else needs a later explicit return or a final value expression for fallthrough.
Nested branches and early returns are supported. Return coverage is conservative:
constant conditions do not eliminate the need for a fallback. Code following an
exhaustively returning chain is rejected as unreachable. Shader if is a statement,
not a value-producing expression. Scalar/vector/matrix and boolean helper returns
follow the same checks; fragment shaders must return vec4f on every path.

`hg/tests/browser-shaders.test.mjs` checks real WebGPU pixels and pipeline reuse in Chrome.
It requires Playwright, pngjs, and the static server; run with those packages
available to Node (for example through NODE_PATH). AIOLI_URL can override localhost:3000.

## Compilation modes

Lisp traces are enabled by default. Uncheck the checkbox to inspect and run
plain generated JavaScript. Changing the checkbox recompiles without execution.
Programmatic callers can use `compile(source, bindings, forms, { trace: false })`.
This emits direct calls without trace wrappers, thunks, or location arguments.
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
Successful runs clear the previous trace. This instrumentation adds runtime
overhead and can be disabled with the checkbox. Generated JavaScript has no source maps yet; native host
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
Operands are numbers, vectors, or matrices with compatible types. Strings,
booleans, BigInts, arbitrary objects, and nil throw TypeError; no
coercion occurs. `%` accepts scalar numbers only.

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
Shader arithmetic supports `+`, `-`, `*`, `/`, and scalar `%`, with the same
arity rules. `%` emits WGSL floating-point remainder, including negative inputs;
shader numeric results use f32 precision and WGSL arithmetic behavior.
Host numbers must be finite. Numeric inputs, source literals, and arithmetic
results reject NaN and infinities, including division by zero and overflow.
`-0` preserves its sign in memory. Overflowing literals such as `1e999` are
rejected. Ordinary scalar arithmetic uses JavaScript precision without type promotion.
Runtime checks apply to every call, including calls through variables.

## Logical operators

`and` and `or` are short-circuit selectors using language truthiness. They accept
any number of operands and evaluate them once, left to right. `and` returns the
first falsey operand or the last operand if all are truthy. `or` returns the first
truthy operand or the last operand if all are falsey. They return original values,
including collection references, without copying or coercion. Empty `(and)`
returns true and empty `(or)` returns false; unary forms return their operand.
`not` accepts exactly one operand, evaluates it once, and negates its language
truthiness. It always returns a boolean.

```lisp
(and true (not false)) ; true
(not nil) ; true
(not (list)) ; true
(not 42) ; false
(or false true) ; true
(or nil "fallback") ; "fallback"
(and 42 "result") ; "result"
(or (list) (list 1)) ; selects the nonempty list
(if (and (in "name" player) (not false)) { (print player.name) })
```

These are compiler forms rather than first-class bindings, so skipped expressions
are not evaluated. Regular code permits different operand types, in both trace
and fast modes: `(and false 42)` returns false, while `(and true 42)` returns 42.
`if` uses the same explicit language truthiness rules described below. Use
`(bool value)` when a boolean result is required instead of a selected value.

Shader selector operands must share one type at compilation, including skipped
branches: bools, scalars, vectors, or matrices. Boolean selectors emit native
WGSL `&&`/`||`; numeric selectors use lifted functions with early returns to retain
lazy evaluation. Vectors and matrices are always truthy, so `or` selects the first
and `and` selects the last. `not` applies the same truthiness conversion as `bool`
before emitting WGSL `!`, including active length for many values.
Shader locals, helper parameters and returns, and assertions support `bool`.
Boolean shader parameters and storage inputs containing boolean fields/elements
are rejected, including nested structures. Supply numeric inputs and explicitly
convert them with `(bool value)` if needed. The outer shader must still return
vec4f; booleans cannot be used as numeric operands.

## Interpolated strings

Prefix a string with `$` to insert values using `{expression}`:

```lisp
(let name "Shawn")
(print $"Hello, {name}!")
(print $"Total: {(+ 2 3)}")
```

Each interpolation contains exactly one Lisp expression, evaluated once from
left to right in the current lexical scope. Values use JavaScript template-string
conversion. `{{` and `}}` produce literal braces. Strings and templates share modern
JavaScript escapes: `\n`, `\r`, `\t`, `\b`, `\f`, `\v`, `\0`, `\xHH`, `\uHHHH`,
and `\u{H...}`; escaped quotes, backslashes, and other nonnumeric characters also
work. Backslash followed by a line ending continues the source without adding a
newline. Unescaped LF/CR, malformed escapes, and legacy numeric escapes are rejected;
`\0` cannot be followed by a digit. Plain strings do not interpolate. Statements cannot be interpolated.
These compile directly to JavaScript template literals.

These source escapes decode to ordinary JS strings. `to-json` still emits valid
JSON, using JSON-compatible escapes; `from-json` still accepts only JSON syntax.
For example, `"\x41"` is the string `"A"`, while a vertical tab written as `"\v"`
serializes as `"\u000b"`. The former `f"..."` template prefix is no longer supported.

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

## Mutable data and copying

`nil` is the language's single no-value sentinel, represented by JavaScript null.
Both the reserved literal `nil` and zero-argument `(nil)` produce null and serialize
as JSON null. `(nil)` accepts no arguments. Missing dict entries,
omitted function arguments, empty returns, function fallthrough, and programs
without a final value all produce nil. Host undefined binding values and call
results are normalized to null at the language boundary. Collection constructors
and `put` normalize host undefined elements too. `null` and `undefined` are not
additional language literals. `(value : nil)` checks that a value is nil.
Shaders accept nil only as a single vector-constructor argument for zero
initialization; nil values and parameters are otherwise unsupported.

```lisp
(let value nil)
(= value nil) ; true
(to-json nil) ; "null"
```

`(bool value)` returns an explicit boolean. Conditions in `if` and `elif` use
the same rule: false, nil, numeric zero (including negative zero), empty strings,
empty lists, empty dicts, and many with zero active elements are false. Nonempty
collections are true even if all their values are nil or false. Many truthiness
uses active length rather than capacity, including in shaders. Whitespace-only strings, functions, vectors, and
matrices are true; a zero vector/matrix is a value, not an empty collection.
Numeric inputs must be finite. No string/number coercion occurs.
Shader truthiness accepts boolean and numeric values: bools retain their value,
zero scalar numbers are false, and vectors/matrices are always true. Shader
literals and numeric parameters still require finite f32 numbers; non-finite
arithmetic results follow WGSL's existing floating-point behavior.

Lists are ordered, mixed-type collections. Dicts have string keys; duplicate keys
use the last supplied value. Dictionary construction requires primitive string
keys and assigns nil to an unmatched final key. Normal call evaluation resolves
arguments before the constructor runs: a string literal, variable, or expression
returning a string is valid. The constructor only validates the resulting key;
it does not evaluate expressions or convert keys. Use an explicit `str` call
when conversion is intended. A single list supplies alternating keys and values;
a single dictionary is returned unchanged. No arguments or a single nil/host
undefined create an empty dictionary. Access and mutation also require string keys.
Parentheses still mean calls, so use constructors:

```lisp
(dict (str 42) "value")  ; { "42": "value" }; explicit conversion
(dict "x")              ; { x: nil }
(dict (list "x" 1))      ; { x: 1 }
(dict nil)              ; empty dictionary
(let original (dict "x" 1))
(dict original)         ; the same object as original
```

```lisp
(let items (list 1 "hello" true))
(get items.0) ; 1
(len items) ; 3
(let player (dict "name" "Shawn" "position" (vec3f 0)))
(get player."name") ; "Shawn"
(let moved (copy player))
(put moved "position" (vec3f 1 0 0))
(= player moved) ; false
```

`put` mutates a list, dict, vector, or matrix and returns that same value.
Assignment shares a reference, so aliases see the change. Lists and vectors use
zero-based integer indices. Matrices use flat column-major indices: column times
dimension plus row. Out-of-range access or replacement throws. Numeric components
must remain numbers. Missing dict keys return nil. `len` returns the number
of elements, components, or dict keys; on strings it counts UTF-16 code units.
`same?` compares identity, while `=` compares collection contents.
`(keys dictionary)` returns a native list
of its own string keys in ordinary JavaScript property order.

To grow a list, use `(insert items value)` to append, or `(insert items value index)`
to insert at a zero-based position and shift later elements right. The optional
index may range from zero through the current length. `(remove items index)`
deletes that element and shifts later elements left; its index must already exist.
An index of nil leaves the list unchanged, allowing
`(remove fruits (where fruits "apple"))` whether or not "apple" is present.
Both operations mutate and return the original list. `put` only overwrites an
existing element and never changes the length. These operations are scene bindings.

```lisp
(let items (list 10 20))
(insert items 30) ; (list 10 20 30)
(insert items 15 1) ; (list 10 15 20 30)
(remove items 0) ; (list 15 20 30)
(put items 1 99) ; (list 15 99 30)
```

`(in value collection)` returns a boolean. For lists it searches for a value using
the same structural equality as `=`; for dicts it checks for a string key,
regardless of the associated value (including nil). Keys are not coerced.
It requires exactly two arguments and supports lists and dicts in scene code.

```lisp
(in 2 (list 1 2 3)) ; true
(in "name" (dict "name" "Shawn")) ; true
(in "Shawn" (dict "name" "Shawn")) ; false: checks keys, not values
```

`(where collection value)` searches values using structural equality, returning
the first matching list index or dict key. It returns nil for either collection
when no match exists. Dicts are searched in JavaScript own-property order (integer
keys numerically, then other string keys in insertion order). Unlike `in`, `where`
searches dict values rather than keys. It is a scene binding with exactly two arguments.

```lisp
(where (list 10 20 30) 20) ; 1
(where (dict "name" "Shawn") "Shawn") ; "name"
(where (list 10 20) 99) ; nil
```

A found index can be 0, and a found dict key can be an empty string. Compare the
result with nil to distinguish a missing value instead of using its truthiness.

Dot notation accesses nested lists and dicts, and can continue into vector swizzles:

```lisp
(let players (list (dict "profile" (dict "first name" "Shawn")
                       "position" (vec3f 1 2 3))))
players.0.profile."first name" ; "Shawn"
players.0.position.zyx ; new (vec3f 3 2 1)
(put players.0.profile "first name" "Alex")
```

The target determines the meaning of each selector: lists require an unquoted
integer index, dicts use the literal selector text as a string key, and vectors
use swizzles. Thus `settings.42` uses dict key "42", while `items.42` uses list index
42. Quoted dict keys support spaces, punctuation, escapes, and empty strings;
`settings."a.b"` accesses one key rather than a chain. Bare keys do not evaluate
variables: use `settings.(get key)` for a dynamic key. Dict misses return nil,
and further access on nil throws. Collection access returns the stored value
by reference; nested `put` calls mutate that value. Every chain evaluates its
source once. Use `put` or a dot target with `set` for explicit changes.

Parenthesized selectors compute their keys, and can appear anywhere in a chain:

```lisp
(let i 0)
items.(+ i 1)
(let key "name")
player.(get key)
(set player.(get key) "Alex")
(get player.name) ; explicit path lookup
(get player)      ; the same binding value as bare player
```

`get` takes exactly one binding name or dot path, including computed paths such
as `(get players.(get i).position.x)`. It is a compiler form; the old two-argument
collection call is removed. Bare binding names continue to resolve implicitly.
Computed dictionary/record keys must be strings, and indexed values require
integer numbers without coercion. Reads evaluate the target and selector once;
`set` evaluates target, selector, and replacement once in that order. Computed
selectors can await in asynchronous host code. Brace blocks remain statement-only.

`copy` accepts every language type. It allocates new storage for lists, dicts,
vectors, and matrices; nested values remain shared. `re-copy` recursively copies
those values, preserving cycles and repeated references within the copied graph.
Recursive operations use the `re-` prefix as a project naming convention.
Primitives, functions, and texture handles retain identity under
either operation. Copying a handle does not duplicate GPU resources or extend its
lifetime; copying a function does not duplicate its captured state.
`=` compares contents recursively, including vector components; dict key order
does not matter. Different data types are unequal. Primitive equality uses
JavaScript Object.is for valid values (negative zero differs from zero);
functions compare by identity.

Lists are native JavaScript arrays and dicts are plain untyped objects. Ordinary
JS arrays, object literals, and null-prototype objects can pass into Lisp directly,
preserving identity. Standalone vectors have named component fields:
`(vec2f 1 2)` produces `{ __type__: "vec2f", x: 1, y: 2 }`. Matrices retain their
registered `type` and mutable `values` storage. `Data.values(vector)` returns a
component snapshot; use `Data.put` or Lisp dot assignment to mutate a vector with
validation. Ordinary JS field writes mutate standalone vectors directly.
Constructors accept primitive values, functions, native lists/dicts, registered
typed data, and opaque runtime handles. Class instances and typed arrays require
their own supported boundary contracts.
Functions are opaque references, so captured state may still change.
Create host vectors through the exported `vectorBindings` constructors;
plain arrays, typed arrays, and lookalike tagged objects are not language vectors.

`(to-json value)` writes native JSON: lists become arrays and dicts become objects.
Vectors encode `__type__` and named components, matrices encode `type`/`values`, and structs encode their
fields, and packed arrays/many encode live elements. Engine ownership metadata is
excluded. `(from-json text)` returns ordinary parsed arrays and objects with finite
number validation, including rejection of overflowing JSON numbers. Tags are ordinary
fields and do not restore runtime types, layouts, capacity, or aliases. Reconstruct
typed values explicitly through their constructors when needed.
Undefined, functions, non-finite numbers, sparse holes, opaque resources, and cycles
are rejected. Native JSON precision applies; negative zero encodes as `0`, and
repeated references become separate values on a JSON round trip.
Lists and dicts remain scene values; extract numeric fields explicitly
when passing data to a shader. Layout records and typed buffers are described below.

Vectors and square matrices are mutable, but arithmetic always produces new
numeric values without changing its operands:

```lisp
(let a (vec3f 1 2 3))
(let b (+ a (vec3f 10 0 0)))
(put b 0 99) ; a is still (vec3f 1 2 3)
(let transform (mat4x4f
  (vec4f 1 0 0 0)
  (vec4f 0 1 0 0)
  (vec4f 0 0 1 0)
  (vec4f 0 0 0 1))) ; identity
(let independent (copy transform))
(put independent 12 5) ; x translation, fourth column
(* independent (vec4f 0 0 0 1)) ; new (vec4f 5 0 0 1)
```

`mat2x2f`, `mat3x3f`, and `mat4x4f` follow WGSL constructor overloads. No arguments
produce a zero matrix. Column-wise construction requires one matching float vector
per column; scalar-wise construction requires all components in column-major order.
A single scalar is rejected, including zero. Identity matrices use explicit columns
or scalar components, or the transform constructors below. The `mat2`/`mat3`/`mat4` aliases use the same overloads.
Matrix addition/subtraction require matching dimensions. Matrix multiplication
uses linear algebra; matrix/vector products require matching dimensions, and
scalar/matrix multiplication scales components. Matrix division is unsupported.
Vector arithmetic is component-wise, with scalar broadcasting and matching
dimensions. Unary `+` and `*` also produce independent numeric storage.

`(2d)` creates an identity `mat3x3f`; `(3d)` creates an identity `mat4x4f`.
Both work in regular code and shaders and accept optional named pairs in any order:

```lisp
(2d translate (vec2 10 20) scale (vec2 2 3) rotate 0.5 skew (vec2 0.1 0))
(3d rotate (vec3 0.1 0.2 0.3) scale 2 translate (vec3 10 20 30)
    skew (array (f32) 0.1 0 0 0 0 0))
(* (2d translate (vec2 10 20)) (vec3 1 2 1)) ; (vec3 11 22 1)
```

`translate` defaults to zero and takes a `vec2f`/`vec3f`. `scale` defaults to one
and accepts a scalar for uniform scaling or a matching float vector. `rotate`
defaults to zero and takes a scalar in 2D or a `vec3f` of Euler angles in 3D.
All angles, including skew angles, use radians. `skew` defaults to zero; in 2D
its `vec2f` components are xy and yx. In 3D it is an array of six f32 angles
ordered xy, xz, yx, yz, zx, zy. Each pair names the output axis then the input
axis: xy adds `tan(angle) * y` to x. Shader storage inputs for 3D skew must be
declared `array<f32,6>`; inline arrays also work.

Transforms apply scale, then skew, then rotation, then translation to column
vectors. 3D rotation applies X, then Y, then Z, using right-handed rotations.
Use a final component of one for points and zero for directions. Bare or quoted
parameter names work in direct calls; calls through local aliases use quoted
names. Unknown or repeated parameters are rejected. Regular constructors require
finite f32 components and reject overflow. Each result owns fresh mutable matrix
storage; constructor inputs are preserved.

`(transform matrix vector)` transforms a point with an implicit final component
of one, divides the remaining coordinates by the final homogeneous coordinate,
then discards that final coordinate.
It accepts `mat3x3f` with `vec2f`, or `mat4x4f` with `vec3f`, in regular code
and shaders. For example, `(transform (2d translate (vec2 10 20)) (vec2 1 2))`
returns `(vec2 11 22)`. Use `*` with an explicit homogeneous vector for directions.

For a final coordinate of zero, regular code rejects the non-finite result.
Use `*` with an explicit homogeneous vector to retain the full result.

`(inverse matrix)` returns a fresh inverse of a `mat2x2f`, `mat3x3f`, or `mat4x4f`
in regular code and shaders. Undo a point transform with
`(transform (inverse matrix) point)`. Cache the inverse when transforming many
points with the same matrix. Regular code rejects nonfinite components, singular
matrices, and inverse results outside finite f32 range. Shader singular matrices
return a zero matrix; use invertible matrices for meaningful results.

Use dot notation for vector components and swizzles in regular code and shaders:

```lisp
(let position (vec4f 1 2 3 4))
position.x ; 1
position.xx ; new (vec2f 1 1)
position.zyx ; new (vec3f 3 2 1)
position.wwww ; new (vec4f 4 4 4 4)
(+ position (vec4f 1)).yx ; swizzle an expression result
position.0 ; same component as position.x
```

All one-to-four character combinations of `x`, `y`, `z`, and `w` are supported,
including repetitions. A selector may only name components present in its source:
vec2f supports x/y, vec3f adds z, and vec4f adds w. Single-component access returns a
number; longer swizzles produce fresh vector storage. Access evaluates the target
once, supports chaining, and does not expose JavaScript object properties. Dot
selectors must directly follow their target. The old component-call bindings
have been removed. Use `put` or `(set vector.xy replacement)` for explicit mutation;
swizzle reads return fresh values, and writable swizzles require distinct components.

Vectors also support unquoted integer dot indices: `v.0`, `v.1`, `v.2`, and `v.3`
select components that exist in the vector. Numeric selectors select one index;
they never combine digits into a swizzle. For example `v.12` attempts index 12.
Matrices use column-first dot indexing. `m.0` is a live column-vector view in
regular code, so `m.0.0` and `m.0.x` access the same matrix component:

```lisp
(let m (mat4x4f
  (vec4f 1 0 0 0)
  (vec4f 0 1 0 0)
  (vec4f 0 0 1 0)
  (vec4f 0 0 0 1)))
(set m.3.0 5) ; column 3, row 0
(set m.3.y 2) ; column 3, row 1
(set m.0 (vec4f 1 0 0 0)) ; replace a complete column
(let column m.3) ; live view
(let detached (copy column)) ; independent vector
```

These reads/writes also work for matrices inside structs and arrays.
Quoted numeric keys remain dict/record keys rather than vector/matrix indices.
Shader numeric dot indices are checked against the known dimensions at compilation.
Computed numeric selectors also work: `v.(get i)` selects a component and
`m.(get column)` selects a column. JS `Data.get` and Lisp `put` retain flat
column-major matrix component indices; Lisp dot paths use the column/vector interface.

Shader parameters accept square matrices and vectors. Every shader call copies
numeric data into its upload buffer immediately: later mutations affect subsequent
calls, including calls within the same frame. Matrix columns occupy separate
padded vec4f uniform slots. Shader locals use WGSL value semantics; `copy` accepts
shader numeric values. Shader `(get name)` and `(get name.x)` resolve typed values
and paths; `put` remains a host storage operation.

## Functions

Ordinary host functions support a final `&rest` parameter, for example
`(fn (first &rest items) ...body)`. It receives the remaining arguments as a native
list, empty when omitted. Its optional type annotation must be `list`. Rest
parameters also work in async functions; shader functions and scene hooks retain
fixed parameter lists.

Functions are values, defined with `fn` and a parenthesized parameter list.
Everything after the parameter list is the body, with an implicit lexical scope.
Name one with `let` and call it like any binding:

```lisp
(let say-hello (fn (name)
  (print (greet name))))
(say-hello "Shawn")

(let identity (fn (value)
  value))
(print (identity 42))
```

Functions emit ordinary JavaScript functions and implicitly return their final
value expression. Explicit `(return value)` remains available to exit early;
bare `(return)` exits with nil. Empty bodies and final non-value statements
return nil. A final brace scope supplies no value, so its inner final expression
does not become a function result; explicit returns inside braces still exit
the enclosing function. Statement-position conditionals, loops, and declarations
keep their existing behavior. Async functions and promise handlers share this rule.
Shaders also accept implicit final values, while requiring a supported typed
result on every path; nil and bare `(return)` remain unsupported in WGSL.
Parameters are mutable locals;
the function body shares their scope, so redeclaring a parameter is an error.
Braces inside the body create an additional nested scope and can shadow parameters.
An empty body is allowed: `(fn ())`. Closures capture live lexical variables,
and functions can call themselves or other functions after initialization.
Untyped parameters receive nil for missing arguments; extra
arguments are evaluated and ignored. Returns are only allowed inside functions.

Run compiler checks with `node --test hg/tests/compiler.test.mjs`.

## Runtime type assertions

Scene functions can mix typed and untyped parameters:

```lisp
(let double (fn (value : num)
  (return (* value 2))))
(print (double 21))
(double "21") ; TypeError: Parameter value: expected num, received str "21"
```

Annotations check incoming arguments before executing the body. Untyped parameters
accept any value. Parameter annotations check incoming arguments only; later
assignments remain ordinary mutable assignments. Optional lifecycle parameters
can also be annotated, for example `(on update (context : dict) ...)`.

Use `(expression : type)` for an explicit assertion anywhere a value is needed.
It evaluates the expression once and returns the original value, without coercion:

```lisp
(let count (42 : f32))
(print ("Hello" : string))
```

The preferred scalar types are `num`, `f32`, `i32`, `u32`, `str`, and `bool`.
`num` is a JavaScript number. `f32` explicitly rounds to IEEE single precision;
`i32` and `u32` hold signed and unsigned 32-bit integers. Scalars remain JavaScript
primitives: guards check representation and range, rather than a hidden scalar tag.
Ordinary literals are num in regular code and f32 in shaders; use i32/u32 constructors
for shader integers. Shader arithmetic requires matching component types, with
explicit conversions between floating, signed, and unsigned values.
Regular scalar arithmetic uses JavaScript number semantics; shader arithmetic uses
its declared WGSL scalar type.

Vectors use `vec2f`–`vec4f`, `vec2i`–`vec4i`, and `vec2u`–`vec4u`.
Their tags distinguish component type and dimension. Empty constructors and a
single nil/host undefined produce zero vectors. A single scalar splats into every
component. Other inputs recursively flatten numeric scalars, lists, and vectors
in order; missing components receive trailing zeros and extra components are
ignored. A single vector creates a copy, trimming or appending zeros as needed.
A single list containing one scalar pads with zeros rather than splatting.
Numeric components use the target scalar's clamping and rounding rules. Deferred
lists and packed vector views use explicit reads. Cyclic lists encountered while
collecting components are rejected.

Shader constructors also recursively flatten inline `(list ...)` expressions,
trim vector expressions, and append zeros; a single numeric scalar remains a
splat. This does not introduce runtime lists or nil values into WGSL.
All valid swizzles preserve the component family, and numeric indices return
scalar components. Writes preserve the component
type. Arithmetic produces new vectors; integer vector arithmetic wraps to 32 bits,
and integer division truncates toward zero. Mixing signed and unsigned vectors
requires an explicit conversion.

```lisp
(num "0.1")                  ; JavaScript precision
(f32 "0.1")                  ; single-precision rounding
(i32 4294967295)              ; 2147483647: clamp to the signed maximum
(u32 -1.9)                    ; 0: truncate, then clamp
(str nil)                     ; "nil"
(vec3f (vec2u 1 2) 3)
(vec2u (vec2i -1 2))           ; unsigned conversion
(vec3f)                      ; (0, 0, 0)
(vec3f 1)                    ; (1, 1, 1), scalar splat
(vec3f (list 1))             ; (1, 0, 0), list padding
(vec4f (vec2f 1 2))          ; (1, 2, 0, 0)
(vec3f 1 (list (list 2) 3 4)) ; (1, 2, 3), extras ignored
(vec3i 1).xx                  ; vec2i
(f32? (f32 0.1))              ; true
(u32? -1)                     ; false
((vec2u 1 2) : vec2u)         ; assertion without conversion
```

`num`, `f32`, `i32`, `u32`, `bool`, and `str` constructors accept zero or one argument.
Omitted numeric values default to `0`, `bool` to `false`, and `str` to `""`.
Numeric conversions accept numbers, booleans, and complete numeric strings,
including hexadecimal, octal, binary, and `:i`/`:u`/`:f` conversion suffixes.
Integer conversion truncates fractions and clamps to the signed/unsigned range; NaN and infinities
are rejected. `str` formats primitives and nil, and rejects compound values.
Finite `f32` construction clamps to the exact finite single-precision range
before rounding. Scalar, vector, and matrix constructors share these conversions.
Predicate bindings `num?`, `f32?`, `i32?`, `u32?`, `str?`, and all nine vector
predicates return booleans. Regular code also provides `list?`, `dict?`, `error?`, `array?`,
`many?`, `texture2d?`, and `binding?`; list/dict predicates recognize native JS collections, including empty
ones, while array/many predicates require registered packed storage and texture2d
requires a registered texture handle. Binding predicates recognize registered
reflection handles; read/write operations separately check their liveness and owner. All predicates
require exactly one argument. Colon assertions and typed parameters use the same guards.
An f32 guard requires an already rounded finite value; shader uploads require
finite values. Scalar f32 shader inputs also accept
JavaScript numbers and round during upload.

`(type value)` evaluates one expression once and returns its Lisp type as a
dunder string. It is a host-code form; WGSL does not support its string result.

```lisp
(type (dict))       ; "__dict__"
(type (list))       ; "__list__"
(type nil)          ; "__nil__"
(type true)         ; "__bool__"
(type "hello")      ; "__str__"
(type 42)           ; "__num__"
(type (i32 42))     ; "__num__"
(type (f32 0.5))    ; "__num__"
(type (vec2f 1))    ; "__vec2f__"
```

All scalar numbers share `"__num__"`; no scalar type tags are introduced.
Other results use canonical names such as `"__mat2x2f__"`, `"__struct__"`,
`"__array__"`, `"__many__"`, `"__function__"`, `"__promise__"`, `"__error__"`,
`"__texture2d__"`, and `"__binding__"`. Host records are dictionaries. Plain dictionary fields,
including `__type__`, do not change their Lisp type. Unsupported native objects
and non-finite numbers are rejected. The JS operation is `Types.type(value)`.

Structs, arrays, and many support bool, f32/i32/u32, all nine vector types, matrices,
and nested fixed-footprint data. Integer values use exact signed/unsigned byte packing
instead of conversion through f32, including mixed structs and values above 2^24.
Uniform slots use unsigned words with explicit shader bitcasts, preserving every bit.
`num` and `str` are regular-code types and are rejected in shader declarations
and packed storage. Shader fragment results must be vec4f colors. Shader integer
conversions and vector conversions also truncate and clamp; non-finite GPU computation
is subject to WGSL's runtime rules.

Float vectors also accept `vec2`, `vec3`, and `vec4`; square matrices accept `mat2`,
`mat3`, and `mat4`. These aliases work in constructors, predicates, colon annotations,
struct fields, and nested array/many types in regular code and shaders. Constructors
produce canonical tags (`vec2f`, `mat2x2f`, etc.), and JSON serialization keeps those
qualified names. Scalar aliases such as `float`, `string`, and `boolean` are not supported.
Other runtime types include nil, function, promise, error, list, dict, struct, array, many, square
matrices, and texture2d. Texture ownership and lifetime are checked at shader calls.

Arithmetic bindings share this assertion machinery. Assertions remain enabled
in fast compilation mode because they define language behavior. Shader expressions
can use colon assertions too; their types are checked at compilation rather than
per pixel. Unsupported annotations fail with Lisp source locations.

## Structs, arrays, and dot assignment

Declare GPU-compatible records with `struct`. Field names can be bare symbols or
quoted strings. Fields support bool, f32/i32/u32, vectors, square matrices, previously declared
structs, and bounded arrays. Definitions have lexical scope and cannot be mutated.

`array` is a compiler form: its first argument specifies the element type and
optional capacity. Remaining arguments are the initial elements:

```lisp
(struct Point
  "a string key":vec2f
  gain:f32)

; Ten elements: the supplied point followed by nine zero-valued points.
(let points
  (array (Point 10)
    (Point "a string key" (vec2f 0.2 0.4) gain 1)))

; Capacity inferred as three. It is still fixed and cannot grow.
(let weights (array (f32) 0.1 0.2 0.3))

(struct Shape
  points:array<Point,10>
  weights:array<f32,3>)
(let shape (Shape points points weights weights))
(set shape.points.0."a string key".x 0.5)
(get shape.points.0."a string key")
```

Explicit capacity must be a positive safe integer within the exact f32 indexing
range. An omitted capacity is inferred from the initial element count, including
zero for an empty array. Neither kind can grow. Initializers cannot exceed capacity.
`len` reports the fixed array length. Every slot is accessible immediately; omitted
initializers become zero-valued elements. `put` and `set` overwrite elements.
Arrays reject both `insert` and `remove`; these operations remain list-only.

Struct constructors require all fields exactly once, in any order. Bare labels work
in direct calls to the declared constructor; aliases use quoted string labels.
Array field annotations require capacity: `array<Point,10>` is allowed and
`array<Point>` is rejected. Nested bounded arrays are supported. Assignments copy
compatible elements into the field's storage, require a matching element type,
and reject lengths exceeding the field capacity. Inline arrays map directly to WGSL fixed-size arrays, without length metadata.

Struct fields, nested structs, array elements, vectors, and matrices expose live
views in regular code. Construction and assignment copy values into packed storage;
`copy` and `re-copy` detach that storage. Boolean writes require strict true/false values. Numeric writes require finite,
f32-representable values. Standalone arrays use f32 storage; standalone structs
retain JavaScript precision within that range. Arbitrary lists and dicts are not
accepted as struct fields or shader arrays.

`bool` is the canonical boolean type.
Host packed boolean fields and `array<bool>`/`many<bool>` elements are stored as
exact f32 zero/one values and decoded to booleans on access. These collections
cannot be passed to shaders: boolean fields/elements at any nesting depth are
rejected rather than encoded for GPU transfer. Shader-local structs and collections
use native WGSL bool fields/elements. Omitted boolean elements initialize to false.

`set` supports dict keys, list/array indices, struct fields, matrix columns, and
vector components. Each target and replacement is evaluated once. Multi-component
swizzle writes require distinct components and snapshot their replacement first.
`set` returns the replacement; `put` returns the collection.

Shaders accept arrays with either a runtime capacity or an explicitly declared one:

```lisp
(let draw
  (sh (points:array<Point,10> weights:array<f32>)
    (let point points.0)
    (set point."a string key".x 0.25) ; modifies a local shader copy
    (return (vec4f point."a string key" weights.0 1))))
(on render (context) (draw context points weights))
```

`array<Point,10>` requires an input with capacity ten; `array<Point>` accepts any
capacity with that element type. Omitting capacity from an annotation does not
make the regular-code array growable. The runtime uploads arrays into readonly
GPU storage buffers and passes their lengths separately when needed. Inline struct
arrays compile directly to fixed-size WGSL arrays.

`get`, dot indexing, `len`, and `copy` work in shaders. Local bounded arrays can be
constructed with `array` and passed to typed helper parameters; those capacities
must be compile-time constants. Struct constructors also work in shaders.
Input storage is readonly, while local copies support dot assignment. CPU invalid
indices throw. Shader reads outside the array length return zero-initialized
elements. Literal local dot writes are checked against the fixed length at compilation;
computed writes validate indices at runtime and ignore invalid indices. Runtime-sized array
helper parameters are unsupported; helpers can reference shader inputs directly.
Standalone structs are not shader inputs; put them into an array instead.

The runtime handles WGSL padding and keeps GPU allocations per draw slot.
Unchanged arrays skip upload; changed arrays currently upload in full. Separate
draws retain independent snapshots. Device binding limits and exact f32 indexing
limits are checked before upload. JSON serialization snapshots struct fields and
array elements as ordinary data; decoding does not reconstruct their storage.
The former `layout` and `buffer` language names
have been replaced by `struct` and `array`.

## Typed collections with many

`many` uses the same element types as `array`, but tracks active length separately
from capacity. Without an explicit capacity it can grow; with one it is bounded.

```lisp
(let values (many (f32) 1 2))
(insert values 3)       ; grows storage when necessary
(insert values 0 0)     ; inserts at index zero and shifts later values
(remove values 1)       ; shifts later values left
(len values)            ; 3 active elements
(cap values)       ; allocated element capacity

(let points (many (vec2f 10))) ; empty, bounded to ten elements
(insert points (vec2f 0.2 0.4))
(set points.0.x 0.5)
```

`cap` returns allocated capacity for many, and the length for arrays, lists, and dicts.
Only active indices are accessible. `put` and `set` overwrite existing elements;
`insert` adds one and `remove` removes one. Removal decreases length and retains
capacity; it does not create a zero-valued hole. A nil removal index does nothing.
Unbounded storage grows geometrically when full, preserving live views at their
storage indices. Bounded insertion fails when full. Invalid edits validate before
changing storage. Empty many values are false in conditions and `bool`.
`where` and `in` search active elements. `copy` and `re-copy` make independent
storage and preserve length, capacity, and whether growth is permitted.

Only bounded many types can appear inside a struct or another inline collection:

```lisp
(struct Shape
  points:many<vec2f,10>)
(let shape (Shape points (many (vec2f) (vec2f 0.2 0.4))))
(insert shape.points (vec2f 0.6 0.8))
```

The field contains a length and a fixed-size WGSL array with the declared capacity.
Construction or assignment copies active elements, preserves the field capacity,
and rejects a mismatched element type or too many active elements.
`many<vec2f>` is not allowed as an inline field because its storage size is unknown.

Shader inputs accept `many<Element>` or `many<Element,Capacity>`. The first accepts
bounded or unbounded many values; the second requires the explicit bound and
matching capacity. Arrays and many are distinct input types. The runtime uploads
the backing storage and supplies active length and capacity separately, updating
GPU allocations when an unbounded many grows.

```lisp
(let draw (sh (points:many<vec2f>)
  (if points (return (vec4f points.0 0 1)))
  (return (vec4f 0 0 0 1))))
(on render (context) (draw context points))
```

Shader inputs are readonly. Local bounded many values support `get`, numeric dot
access, `len`, `cap`, `bool`, `copy`, dot assignment, and statement-position
`insert`/`remove`. They can be passed to bounded helper parameters. Local capacity
must be a compile-time constant, and shader storage cannot grow. Shader reads
outside active length return a zero-valued element. Invalid edits, including
insertion when full, leave the value unchanged because shaders cannot throw;
regular code throws. JSON serialization snapshots active many elements as a
native array; decoding does not reconstruct capacity or packed storage.

## Explicit conversions

`bool`, `num`, `f32`, `i32`, `u32`, and `str` are ordinary, first-class bindings.
Each accepts zero or one argument. Omitted numeric values default to `0`, and
`str` defaults to `""`; `(bool)` defaults to `false`. Explicit arguments retain
their conversion rules, including `(str nil)` returning `"nil"`. Colon assertions
check values without converting.

```lisp
(num "42.5")       ; 42.5, JavaScript precision
(num "0xff:u")     ; 255, unsigned conversion
(num "0o77:i")     ; 63, signed conversion
(num "0b10:f")     ; 2, single precision
(num "0.1:f")      ; 0.10000000149011612, immediately rounded
0xff:u             ; 255, same conversion in a source literal
0.1:f              ; immediately rounded f32 literal
(f32 "0.1")        ; single precision
(i32 4294967295)    ; 2147483647, clamped to the signed maximum
(u32 -1)           ; 0, clamped to the unsigned minimum
(str nil)          ; "nil"
(str -0)           ; "-0"
```

Numeric conversions accept numbers, bools, and trimmed complete numeric strings.
String bodies use JavaScript `Number` parsing, including decimal/exponent,
hexadecimal (`0x`), octal (`0o`), and binary (`0b`) forms. An optional trailing
`:i`, `:u`, or `:f` applies the corresponding clamping/rounding conversion.
Outer constructors then apply their own conversion; `(u32 "-1:i")` returns `0`.
Nil, empty or partial strings, unknown/repeated suffixes, and non-primitive objects
are rejected. All numeric conversions reject NaN, infinities, and overflowing
numeric strings before clamping. `f32` clamps finite inputs to its
range before IEEE single-precision rounding. `i32` and `u32` truncate fractions,
then clamp to their signed/unsigned range. Integer vector operations wrap, float
operations round, and ordinary scalar arithmetic uses JavaScript precision;
non-finite host results throw. Guards validate without conversion.

`str` formats nil, bools, numbers, and strings without invoking host coercion hooks.
Collections and functions are rejected; use `to-json` for supported collection data.
In shaders, numeric scalar conversions and vector-family conversions are supported;
`num`, `str`, and string parsing belong to regular code.

## Forms

Forms control evaluation. Add emitters to `forms.js`; each receives an array of
AST arguments, `emit(node)`, and a compiler context. Return an expression string
or `{ statement: javascript }`. The context exposes `inStatement`,
`declaration(symbolNode)`, `assign(symbolNode)`, `block(nodes)`, `statement(node)`,
`function(parameterNodes, bodyNodes)`, `condition(node)` (language truthiness),
`selector(nodes, operator)` (lazy and/or selection), and `inFunction`.
An optional emitter property `declares(args)` returns a declared symbol, registering
it in its containing scope before code generation. Form names take precedence
over bindings in call position.

Scene conditionals use language truthiness and execute only the first matching
branch. `else` is optional, as are any `elif` branches:

```lisp
(if ready {
  (print "Ready")
} elif waiting {
  (print "Waiting")
} else {
  (print "Stopped")
})
(if ready (print "Ready"))
(if ready (print "Ready")
  elif waiting { (print "Waiting") (print "Try again later") }
  else (print "Stopped"))
```

`elif` and `else` are bare keywords within `if`. Each branch accepts either one
statement or a brace block containing multiple statements, with its own lexical
scope in either case. Branches may mix these styles freely in regular code and
shaders. Conditions are evaluated once, in order,
until one succeeds. Without `else`, no matching condition means no branch executes.
These block conditionals require statement position and support explicit returns
inside functions. Shader conditionals use the same branch syntax and require
consistent return types and complete return coverage.

The shorthand `(if condition then)` and `(if condition then else)` also remain
available. Statement-position shorthand emits scoped JavaScript branches;
expression-position shorthand emits a lazy ternary, returning nil when a
false condition has no else value. Blocks cannot be used as expression values.

Reader nodes are `{ kind: 'literal', value }`, `{ kind: 'symbol', name }`,
`{ kind: 'access', target, key, quoted }`, and
`{ kind: 'list', items }`, `{ kind: 'block', items }`, and `{ kind: 'template', parts }`.
Template parts are literal strings or `{ kind: 'interpolation', expression }` nodes.
Computed access nodes additionally carry `computed: true`, with `key` holding the
selector expression AST instead of literal key text.
Suffixed numeric literals also carry a `scalarType` field (`i32`, `u32`, or `f32`)
for shader lowering; host values remain ordinary JavaScript numbers.
The reader supports finite decimal/exponent, hexadecimal, octal, and binary numbers
with optional adjacent `:i`, `:u`, or `:f` suffixes, JS-escaped strings and `$"` templates,
booleans, parenthesized lists, brace-delimited blocks, and semicolon comments. Multiple top-level expressions run in
order; a final expression's value is returned. A final statement or empty source
returns nil. Blocks are statements, not value-producing expressions.

Literal suffixes apply constructor clamping/rounding while reading. In shaders,
they select the corresponding WGSL scalar type. Unsuffixed shader numbers retain
the existing f32 behavior. Colon-letter suffixes are distinct from hexadecimal
digits and full type annotations such as `value:f32` or `(value : f32)`.

The compiler has no knowledge of print or greet. Forms are trusted JavaScript extensions;
execution runs with the page's privileges, not in a sandbox.
