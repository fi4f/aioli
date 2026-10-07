# Aioli

The runtime, compiler, language library, browser adapters, and application hosts
are separated under `engine/` and `hosts/`. See [ARCHITECTURE.md](./ARCHITECTURE.md)
for the boundaries and the remaining self-hosted editor work.

Open `/editor.html` to load `editor/main.lisp` through a minimal browser host.
Mayo draws its own highlighted source editor, line-number gutter, caret,
selection, and errors through the canvas. The demo Lisp source is formatted
and commented to explain how the editor works.
Its Lisp script debounces edits for 400 ms and reloads itself. `text-proxy` supplies
invisible browser input; `aioli` exposes source, shared state, and self-reload.
`aioli.tokenize(source)` exposes tolerant lexical spans from the compiler's
shared scanner; the syntax palette and styled text rendering remain in Lisp.
Changes stay in memory. Mayo uses `(wrap false)` to clip source lines without reflow.
The existing development playground remains at `/index.html`.

Mayo redraws when its document, selection, viewport, or diagnostic changes,
and reuses the completed image otherwise. Visible source is batched into one
cached text texture; source, selection, and caret compose in one GPU pass.
Selection and fractional scroll changes reuse that texture.
`node scripts/profile-mayo.cjs` samples JavaScript frame
and redundant input-notification costs in headless Chrome (requires Playwright;
set `AIOLI_URL` for a server other than localhost:3000).

Run `npx serve` from the project root and open `/index.html`.
Run executes source; output goes to the browser
console. The second textarea shows the exact generated function body, whose
arguments are `$bindings`, `$shaders` (cached shader values), `$assert` (strict
type assertions), `$access` (collection and vector dot access), `$nil` (host no-value normalization),
`$bool` (language conditions), `$text` (text builder operations), and, in trace
mode, `$trace` (the trace helpers). A separate textarea shows generated WGSL.

## Graphics

The developer-supplied canvas is the **outer canvas**, using its default Canvas
2D context. The runtime creates a separate offscreen **inner canvas** for WebGPU
rendering. Shader coordinates, contexts, clear, textures, and previous-pass images
all use inner pixels. WebGPU is still required; Canvas 2D presents the completed
inner image and does not replace GPU rendering. Run is enabled once graphics is ready.
Unavailable WebGPU, device loss, and GPU errors are shown in the page and console.
Use localhost via `npx serve`, or HTTPS.

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

The canvas is opaque and initially black. Clear updates a color uniform and
submits a full-canvas triangle whose fragment shader returns that color.
Alpha is preserved in the output texture and `context.before` for subsequent
shader sampling, even though the displayed canvas is opaque.
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
bodies. For example, `(text "Hello " (weight bold) f"{name}")` appends two spans.
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
pixel coordinates, including inside shader helpers. `(get label "uv")` also
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
text snapshots reuse cached textures; the cache retains the latest 128 entries.
Eviction preserves textures still referenced by labels or handles. Resources are
released on runtime destruction, and evicted unreferenced textures can be collected.
For custom web fonts, load the font before creating text. Rebuilding after a font
becomes available uses its new metrics. Raster text has a fixed resolution.
`examples/text.lisp` is a complete scene.

Compiler-only callers without the browser graphics runtime receive an inspectable
dictionary with `content` and styled `runs`, with no GPU allocation. The compiler's
`textRenderer` option supplies the snapshot-to-resource adapter; Aioli supplies
its Canvas 2D rasterizer and persistent texture uploader automatically.
Run text compiler and layout checks with `node --test tests/text.test.mjs`.

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
`get` access works too. These are read-only resource properties. Position and
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
through an ordinary value. Functions use explicit `return`; otherwise they
resolve to `nil`. Nested regular `fn` bodies and text builders stay synchronous.
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
  (let value (await (async x)))
  (return (+ value 1)))))
(let pending (calculate 4))
```

`async` with any other input is a dispatch/chain expression. It defers its initial expression, turns its
result into a promise, and supports any number of `then`, `catch`, and `finally`
stages in source order:

The single literal `(fn ...)` case creates an async function; it does not
dispatch or call that function. A function held in a variable is an ordinary
dispatch value: `(async callback)` resolves to the function without invoking it.
Use `(async (callback arguments))` to dispatch a call. `(await value)` waits for
a result and never implicitly invokes function values. The former `promise`
chain form is removed; the `promise` type and explicit helpers remain available.

```lisp
(async (calculate 4)
  then (value) { (return (* value 2)) }
  then (value) { (print value) (return value) }
  catch (error) { (print error.message) (return 0) }
  finally { (print "finished") })
```

`then` and `catch` accept a parameter list with zero or one parameter, and one
statement or brace block as the body. `finally` accepts a statement or block
without parameters. All handlers can use `await`. Returned promises are adopted
before the next stage; thrown errors reject the chain. A normally completing
`catch` recovers and allows later `then` stages to run. `finally` preserves the
previous result or rejection unless cleanup throws or rejects. Catch arguments
are dictionaries containing `name` and `message`. `(throw error)` rethrows a
caught error; `(throw "message")` raises an error. The chain returns a promise.

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

Use `(async value)` to produce a promise and `(async (throw "message"))` to
reject one. Evaluation of the initial expression is deferred. Use the
`then`, `catch`, and `finally` stages of `async` for chaining; the former
`promise-*` helper bindings have been removed. Promises can be stored in
dictionaries and lists or asserted with the `promise` type.

Async scene callbacks use an explicit async function body:

`on` accepts an explicit `fn`, an `async`-wrapped `fn`, or a function variable/
dictionary field. For example, `(on keydown (fn (event) ...body))` or
`(on keydown handler)`. The original `(on keydown (event) ...body)` shorthand
also works. Function bindings are captured when the scene is initialized;
reassigning the variable later does not replace the registered callback.
The same parameter limits and synchronous update/render restriction apply to
function variables and inline declarations.

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

Create a runtime with optional inner dimensions and a scale increment:

```javascript
const runtime = new Aioli({
  innerCanvas: { width: 320, height: 180, scaleStep: 1 }
});
await runtime.attach(outerCanvas);
runtime.configureInnerCanvas({ width: 640, height: 360, scaleStep: 0.5 });
```

The runtime owns sizing of both canvases. At attachment and when the outer
canvas is resized, it reads `getBoundingClientRect()` and sets the outer bitmap
to the rounded rectangle dimensions (minimum one pixel). A runtime-owned
`ResizeObserver` detects layout changes; frame preparation also checks bounds.
`width` and `height` default independently to that measured size. Set either
to `null` to resume following that outer dimension.
The inner image is centered and scaled uniformly to fit. A positive `scaleStep`
snaps the fit scale down to a multiple of that increment: 1 gives integer scales,
0.5 gives half-step scales. When no increment fits, the minimum increment is kept
and the image is cropped symmetrically. Zero or `null` disables scale snapping.
The outer canvas paints black borders and uses nearest-neighbor drawing,
with smoothing and filters disabled. Control the displayed size through layout
or CSS; the host does not need to maintain bitmap attributes or resize listeners.
Explicit inner dimensions still control the logical rendering resolution.

Regular Lisp can change configuration from anywhere; no dedicated configuration
callback is required. `configure` accepts a dictionary or key/value pairs;
keys in the pair form can be symbols or strings. `(configure)` leaves the
configuration unchanged and returns the requested settings:

```lisp
(configure w 320 h 180 scale-step 1 ups 120)
(configure (dict "w" 320 "h" 180 "scale-step" 1 "ups" 120)) ; equivalent dictionary form
(configure (dict "w" nil)) ; width follows the outer canvas again
(let view (canvas))
```

`ups` sets updates per second (default 60) and must be a positive finite number.
It can also be passed as `new Aioli({ ups: 120 })`. Rendering always follows
the browser’s animation frames. Update time accumulates, including unfinished
catch-up work; changing `ups` preserves this backlog and takes effect on the
next frame. `(configure)` includes the requested `ups`.

Configuration changes apply at the next frame boundary, before updates/rendering
or a standalone `clear`. A change during a shader/render callback leaves that
callback's dimensions unchanged. `(canvas)` returns the applied canvas size:
`w`, `h`, and `wh`. Lisp operates in canvas coordinates. Presentation layout and
coordinate conversion are managed by the runtime; JavaScript can use
`runtime.display.layout()`, `runtime.display.toInner(x, y)`, and
`runtime.display.toOuter(x, y)` for embedding and overlays.

```lisp
(on resize (event)
  (print event.wh event.old-wh))
```

`resize` fires after an applied inner width or height change and before the
next update/render callback. Its dictionary contains `w`, `h`, `wh`, `old-w`,
`old-h`, and `old-wh`. It covers configured size changes and outer resizes
that affect an automatic inner dimension. Initial attachment, scale changes,
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
| `keydown`, `keyup` | `code` (physical key, e.g. `KeyW`), `key`, `repeat`, `alt`, `ctrl`, `shift`, `meta` |
| `pointerdown`, `pointerup`, `pointermove`, `pointercancel`, `pointerenter`, `pointerleave` | `id`, `type` (`mouse`/`touch`/`pen`), `primary`, inner `x`, `y`, `xy`, `uv`, `inside`, `button`, `buttons`, `pressure`, modifier booleans |
| `wheel` | `dx`, `dy`, `dz`, `mode` (browser delta units), modifier booleans |
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

The editor is a consumer of the library, not part of the runtime. Import the
ES module in an HTML script tag, create an instance, attach your canvas, and
provide source text or load a source file:

`aioli.js`, the HTML pages, and this README live at the project root. Runtime
modules live in `engine/`, tests in `tests/`, and sample scenes in `examples/`.

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
options include `bindings`, `trace`, and `onError` (for asynchronous GPU errors).
Synchronous compilation/execution and loading errors throw to the caller.
Call `runtime.destroy()` to release GPU resources and canvas ownership.
Only one runtime may own a canvas at a time.

Loops are statement forms in regular code and shaders:

`<`, `>`, `<=`, and `>=` accept exactly two numeric scalars and return a boolean,
in regular code and shaders. Shader operands must share a scalar type (`f32`,
`i32`, or `u32`); convert explicitly when needed. For example,
`(while (< i 10) (set i (+ i 1)))`. Vectors, matrices, and nonnumeric values
are rejected. Regular-code NaN comparisons return false.

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

Shader `for` range and count bindings are f32 values. Bounds must be integers within Â±16777216
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
ordinary dictionaries: `get`, dot access, and `copy` work. Each invocation gets a
new snapshot. Mutating timing/dimension fields does not change the scheduler,
canvas, or numeric shader builtins. Copies, update contexts, and saved render contexts cannot
authorize shader calls in another frame.
Elapsed frame time accumulates, and every update receives
exactly `1 / ups` seconds. Fractional time carries into subsequent frames.
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
(await (set-scene "./scenes/menu.lisp"))
```

`set-scene` loads a script as a scene, waits for its initialization, and installs
its callbacks. All callbacks are optional; a script with none simply runs its
initialization and stays idle. Each activation gets fresh scene locals, while
imported modules stay shared. The existing scene keeps running during loading;
failed loads leave it active, and newer activation requests supersede older
ones. Superseded initialization is not cancelled and its effects are not rolled
back. JavaScript `runtime.load(path)` performs the same path-based loading;
`runtime.setScene(source)` continues to accept source text.

Paths follow URL resolution: relative paths resolve against the importing
script's URL, absolute URLs and root-relative paths are supported, and queries
identify distinct modules. Fragments are ignored. Paths are exact: there is no
extension guessing, directory search, or package-name resolver. The default
base URL is the document's base URI. Set `new Aioli({ baseURL: ... })` or pass
`{ sourceURL: ... }` when compiling/running source text to establish its origin.
Imports inside a function retain the URL of the script that defined it.

Fetch, compile, and initialization failures reject the import promise; failed
modules can be retried. Circular initialization dependencies reject with their
URL chain. Destroying a runtime discards its module cache and prevents pending
loads from being initialized or installed. The runtime's optional `fetch`
constructor setting can supply a custom fetch-compatible source loader.
Callbacks are synchronous. Run checks with
`node --test tests/compiler.test.mjs tests/scenes.test.mjs tests/shader.test.mjs tests/types.test.mjs tests/data.test.mjs tests/graphics.test.mjs tests/swizzle.test.mjs tests/access.test.mjs tests/logical.test.mjs tests/nil.test.mjs tests/truthiness.test.mjs tests/selectors.test.mjs tests/conversions.test.mjs tests/structs.test.mjs tests/bool-structs.test.mjs tests/numeric-types.test.mjs tests/arrays.test.mjs tests/many.test.mjs tests/cap.test.mjs tests/matrix-access.test.mjs tests/matrix-names.test.mjs tests/type-aliases.test.mjs tests/constructors.test.mjs tests/transforms.test.mjs tests/shader-conditionals.test.mjs`.

Swizzle reads and writes use checked-in generated accessors in
`engine/swizzles.generated.js`. Regenerate them with
`node scripts/generate-swizzles.mjs`; verify the file is current with
`node scripts/generate-swizzles.mjs --check`. Generation covers every valid
one-to-four component selector for all vector dimensions and numeric families.
Writable selectors contain distinct components. Runtime access validates the
target and replacement, then calls the accessor with explicit component indices;
multi-component reads keep fresh storage and writes snapshot replacements first.

Vector arithmetic also uses checked-in generated operations in
`engine/arithmetic.generated.js`. Regenerate with
`node scripts/generate-arithmetic.mjs`, or verify with `--check`. Operations cover
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
Textures expose read-only `w` and `h` pixel dimensions and `wh` as a `vec2f`,
in regular code and shaders: `image.w`, `image.h`, `image.wh`, or
`(get image "wh")`. This includes shader outputs, `context.before`, and text
textures such as `label.texture.wh`. Each regular-code `wh` read returns a fresh vector.
Inside shaders, textures also expose `image.uv`, equivalent to `xy / image.wh`.
It uses the current pixel coordinates even inside helpers or when a local `uv`
variable exists. `(get image "uv")` also works. For example,
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
`f32`, `vec2f`, `vec3f`, `vec4f`, `mat2x2f`, `mat3x3f`, and `mat4x4f`; boolean parameters
support `bool`, and resource parameters support `texture2d`:

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
`mat4x4f`, or `texture2d`. Returns are inferred and must explicitly return a boolean, scalar,
vector, or matrix; only the outer shader must return vec4f. Numeric parameters
remain mutable through generated local copies; texture
parameters are GPU resource inputs and cannot be assigned.

Helpers can call other helpers and contain nested let-bound helpers. Generated
names preserve lexical scope and shadowing after lifting. Built-in shader inputs
and declared uniforms remain accessible; pixel position is passed automatically.
Other outer locals and parameters must be passed explicitly rather than captured.
Recursive cycles, argument type/arity mismatches, reassignment of helpers, and
using function references as data are compile errors. Anonymous helper calls and
function aliases are not implemented: bind each shader fn directly using let.
See `examples/gradient-helper.lisp` for a complete scene.

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
(sh (enabled:bool)
  (if enabled {
    (return (vec4f 1 0 0 1))
  } elif 0 {
    (return (vec4f 0 1 0 1))
  } else {
    (return (vec4f 0 0 1 1))
  }))
```

Every shader/helper path must return a value, and return types must agree across
all paths. An if without a returning else needs a later return for fallthrough.
Nested branches and early returns are supported. Return coverage is conservative:
constant conditions do not eliminate the need for a fallback. Code following an
exhaustively returning chain is rejected as unreachable. Shader if is a statement,
not a value-producing expression. Scalar/vector/matrix and boolean helper returns
follow the same checks; fragment shaders must return vec4f on every path.

`tests/browser-shaders.test.mjs` checks real WebGPU pixels and pipeline reuse in Chrome.
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
Numbers retain JavaScript floating-point behavior, including Infinity and NaN
results and negative zero. `NaN`, `Infinity`, and `-Infinity` are reserved numeric
literals; `-0` preserves its sign. Overflowing ordinary literals such as `1e999`
are rejected; write `Infinity` explicitly. There is no separate integer type or type promotion.
Runtime checks apply to every call, including calls through variables.

## Logical operators

`and` and `or` are short-circuit selectors using language truthiness. They accept
any number of operands and evaluate them once, left to right. `and` returns the
first falsey operand or the last operand if all are truthy. `or` returns the first
truthy operand or the last operand if all are falsey. They return original values,
including collection references, without copying or coercion. Empty `(and)`
returns true and empty `(or)` returns false; unary forms return their operand.
`not` remains strict boolean negation and requires exactly one boolean operand.

```lisp
(and true (not false)) ; true
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
and `and` selects the last. `not` emits `!` and still requires a boolean.
Shader locals, helper parameters and returns, assertions, and shader parameters
support `bool`. Boolean shader parameters are validated on the host and
uploaded as numeric 0/1 slots, then decoded into WGSL bool values. The outer
shader must still return vec4f; booleans cannot be used as numeric operands.

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

## Mutable data and copying

`nil` is the language's single no-value sentinel, represented by JavaScript null.
It is a reserved literal and serializes as JSON null. Missing dict entries,
omitted function arguments, empty returns, function fallthrough, and programs
without a final value all produce nil. Host undefined binding values and call
results are normalized to null at the language boundary. Collection constructors
and `put` normalize host undefined elements too. `null` and `undefined` are not
additional language literals. `(value : nil)` checks that a value is nil.
Shaders do not accept nil literals or parameters.

```lisp
(let value nil)
(= value nil) ; true
(to-json nil) ; "null"
```

`(bool value)` returns an explicit boolean. Conditions in `if` and `elif` use
the same rule: false, nil, numeric zero (including negative zero), NaN, empty strings,
empty lists, and empty dicts are false. Nonempty lists/dicts are true even if all
their values are nil or false. Whitespace-only strings, functions, vectors, and
matrices are true; a zero vector/matrix is a value, not an empty collection.
Positive and negative Infinity are true. No string/number coercion occurs.
Shader truthiness accepts boolean and numeric values: bools retain their value,
zero scalar numbers are false, and vectors/matrices are always true. Shader
literals and numeric parameters still require finite f32 numbers; non-finite
arithmetic results follow WGSL's existing floating-point behavior.

Lists are ordered, mixed-type collections. Dicts have string keys; duplicate keys
use the last supplied value. Parentheses still mean calls, so use constructors:

```lisp
(let items (list 1 "hello" true))
(get items 0) ; 1
(len items) ; 3
(let player (dict "name" "Shawn" "position" (vec3f 0)))
(get player "name") ; "Shawn"
(let moved (copy player))
(put moved "position" (vec3f 1 0 0))
(= player moved) ; false
```

`put` mutates a list, dict, vector, or matrix and returns that same value.
Assignment shares a reference, so aliases see the change. Lists and vectors use
zero-based integer indices. Matrices use flat column-major indices: column times
dimension plus row. Out-of-range access or replacement throws. Numeric components
must remain numbers. Missing dict keys return nil. `len` returns the number
of elements, components, or dict keys.

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
variables: use `(get settings key)` for a dynamic key. Dict misses return nil,
and further access on nil throws. Collection access returns the stored value
by reference; nested `put` calls mutate that value. Every chain evaluates its
source once. Use `put` or a dot target with `set` for explicit changes.

`copy` accepts every language type. It allocates new storage for lists, dicts,
vectors, and matrices; nested values remain shared. `re-copy` recursively copies
those values, preserving cycles and repeated references within the copied graph.
Recursive operations use the `re-` prefix as a project naming convention.
Primitives, functions, and texture handles retain identity under
either operation. Copying a handle does not duplicate GPU resources or extend its
lifetime; copying a function does not duplicate its captured state.
`=` compares contents recursively, including vector components; dict key order
does not matter. Different data types are unequal. Primitive equality uses
JavaScript Object.is (NaN equals NaN, and negative zero differs from zero);
functions compare by identity.

Lists, dicts, vectors, and matrices have fixed JavaScript tags with mutable
`values` storage. Lists, vectors, and matrices use arrays; dicts use objects with no prototype.
For example, `(vec2f 1 2)` produces `{ type: "vec2f", values: [1, 2] }`.
Constructors accept primitive values, functions, registered language data, and opaque runtime handles;
arbitrary host objects and arrays cannot be stored as collection elements.
Functions are opaque references, so captured state may still change.
Create host vectors through the exported `vectorBindings` constructors;
plain arrays, typed arrays, and lookalike tagged objects are not language vectors.

`(to-json value)` serializes tagged data, and `(from-json text)` validates tags
and restores registered, mutable values recursively. Raw JSON objects and arrays
are not accepted as language collections. Undefined, functions, NaN, Infinity,
and negative zero cannot be saved through to-json because JSON cannot preserve
them losslessly. Cycles are rejected, and repeated references become separate
values on a JSON round trip. JavaScript's JSON.parse alone does not restore language types.
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

For a final coordinate of zero,
regular code follows floating-point division semantics (infinity or NaN).
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
`get` and `put` retain their existing flat column-major component indexing for
matrices; matrix dot indexing provides the column/vector interface.

Shader parameters accept square matrices and vectors. Every shader call copies
numeric data into its upload buffer immediately: later mutations affect subsequent
calls, including calls within the same frame. Matrix columns occupy separate
padded vec4f uniform slots. Shader locals use WGSL value semantics; `copy` accepts
shader numeric values. `get`, `put`, and collections currently belong to scene code.

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
`(return)` or reaching the end returns nil. Parameters are mutable locals;
the function body shares their scope, so redeclaring a parameter is an error.
Braces inside the body create an additional nested scope and can shadow parameters.
An empty body is allowed: `(fn ())`. Closures capture live lexical variables,
and functions can call themselves or other functions after initialization.
Untyped parameters receive nil for missing arguments; extra
arguments are evaluated and ignored. Returns are only allowed inside functions.

Run compiler checks with `node --test tests/compiler.test.mjs`.

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

Vectors use `vec2f`â€“`vec4f`, `vec2i`â€“`vec4i`, and `vec2u`â€“`vec4u`.
Their tags distinguish component type and dimension. Constructors accept numeric
components, scalar splats, vector composition, same-dimension vector conversions,
and no arguments for zero initialization. A single scalar splats into every
component; a single vector performs same-dimension conversion/copy. Mixed scalar
and vector arguments must supply exactly the required number of components. All valid swizzles preserve the component
family, and numeric indices return scalar components. Writes preserve the component
type. Arithmetic produces new vectors; integer vector arithmetic wraps to 32 bits,
and integer division truncates toward zero. Mixing signed and unsigned vectors
requires an explicit conversion.

```lisp
(num "0.1")                  ; JavaScript precision
(f32 "0.1")                  ; single-precision rounding
(i32 4294967295)              ; -1
(u32 -1.9)                    ; 4294967295: truncate, then wrap
(str nil)                     ; "nil"
(vec3f (vec2u 1 2) 3)
(vec2u (vec2i -1 2))           ; unsigned conversion
(vec3i 1).xx                  ; vec2i
(f32? (f32 0.1))              ; true
(u32? -1)                     ; false
((vec2u 1 2) : vec2u)         ; assertion without conversion
```

`num`, `f32`, `i32`, `u32`, and `str` conversions require one argument.
Numeric conversions accept numbers, booleans, and complete decimal strings.
Integer conversion truncates fractions and wraps modulo 2^32; NaN and infinities
are rejected. `str` formats primitives and nil, and rejects compound values.
Predicate bindings `num?`, `f32?`, `i32?`, `u32?`, `str?`, and all nine vector
predicates return booleans. Regular code also provides `list?`, `dict?`, `array?`,
and `many?`; these recognize registered language collections, including empty ones,
and return false for host arrays/objects or a different collection kind. All predicates
require exactly one argument. Colon assertions and typed parameters use the same guards.
An f32 guard requires an already rounded value (including NaN/Infinity in regular
code); shader uploads require finite values. Scalar f32 shader inputs also accept
JavaScript numbers and round during upload.

Structs, arrays, and many support bool, f32/i32/u32, all nine vector types, matrices,
and nested fixed-footprint data. Integer values use exact signed/unsigned byte packing
instead of conversion through f32, including mixed structs and values above 2^24.
Uniform slots use unsigned words with explicit shader bitcasts, preserving every bit.
`num` and `str` are regular-code types and are rejected in shader declarations
and packed storage. Shader fragment results must be vec4f colors. Shader integer
conversions and vector conversions also truncate and wrap; non-finite GPU computation
is subject to WGSL's runtime rules.

Float vectors also accept `vec2`, `vec3`, and `vec4`; square matrices accept `mat2`,
`mat3`, and `mat4`. These aliases work in constructors, predicates, colon annotations,
struct fields, and nested array/many types in regular code and shaders. Constructors
produce canonical tags (`vec2f`, `mat2x2f`, etc.), and JSON serialization keeps those
qualified names. Scalar aliases such as `float`, `string`, and `boolean` are not supported.
Other runtime types include nil, function, list, dict, struct, array, many, square
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
(get shape.points.0 "a string key")
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

`bool` is the canonical boolean type .
Boolean fields and `array<bool>`/`many<bool>` elements are stored as exact f32
zero/one values and decoded to booleans on access. WGSL bool is not host-shareable,
so generated shared structs contain f32 fields instead of raw bool fields. Shader
constructors and assignments encode bool values, while reads and helpers expose
logical bool values. Omitted boolean elements initialize to false.

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
elements; local dot writes are checked against the fixed length at compilation. Runtime-sized array
helper parameters are unsupported; helpers can reference shader inputs directly.
Standalone structs are not shader inputs; put them into an array instead.

The runtime handles WGSL padding and keeps GPU allocations per draw slot.
Unchanged arrays skip upload; changed arrays currently upload in full. Separate
draws retain independent snapshots. Device binding limits and exact f32 indexing
limits are checked before upload. Structs and arrays do not yet support
schema-aware JSON serialization. The former `layout` and `buffer` language names
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
regular code throws. Many values require schema-aware JSON serialization, which
is not yet supported.

## Explicit conversions

`bool`, `num`, `f32`, `i32`, `u32`, and `str` are ordinary, first-class bindings.
Each requires exactly one argument. Colon assertions check values without converting.

```lisp
(num "42.5")       ; 42.5, JavaScript precision
(f32 "0.1")        ; single precision
(i32 4294967295)    ; -1, 32-bit wrapping
(u32 -1)           ; 4294967295
(str nil)          ; "nil"
(str -0)           ; "-0"
```

Numeric conversions accept numbers, bools, and trimmed complete decimal strings,
including optional signs and exponents. Nil, empty or partial strings, hexadecimal
notation, and non-primitive objects are rejected. `num` accepts explicit NaN and
Infinity spellings; overflowing decimal strings throw instead of silently producing
Infinity. `f32` rounds with IEEE single precision. `i32` and `u32` reject non-finite
inputs, truncate fractions, then wrap modulo 2^32.

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
The reader supports numbers (including the special literals above), JSON-escaped strings,
booleans, parenthesized lists, brace-delimited blocks, and semicolon comments. Multiple top-level expressions run in
order; a final expression's value is returned. A final statement or empty source
returns nil. Blocks are statements, not value-producing expressions.

The compiler has no knowledge of print or greet. Forms are trusted JavaScript extensions;
execution runs with the page's privileges, not in a sandbox.
