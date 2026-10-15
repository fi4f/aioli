# Composable Lisp UI

The UI library is [hg/ui.lisp](../hg/ui.lisp). Components, layout, painting,
hit testing, event routing, focus, scrolling, docking, and resizing are ordinary
Lisp. The engine supplies compilation, textures, canvas input, and invisible
native text editing. It does not implement JavaScript widgets or visible DOM UI.

The current implementation is a prototype. The headless Chrome profiler exercises
startup, hovering, typing, and pane dragging, including a large document. The full
editor test suite has not been run against this rewrite.

The editor's colors, typography, docking settings, text cache settings, and icon
assets live in [editor/theme.lisp](../editor/theme.lisp). It supplies a Monokai-style
palette and styles ordinary Lisp components through `Theme.apply`. Icons load
through `(await (image url))`, which returns an app-owned persistent texture and
resolves URLs against the defining Lisp module. `ui-icon` accepts these textures
or a URL string, loading the latter asynchronously when mounted. Icon strings
resolve against the Lisp file containing the constructor call, like `image` and
`import`. In `/editor/main.lisp`, use `./icons/code.png`; `/editor/icons/code.png`
is an absolute project path. The constructor retains this origin when mounted
later. The supplied monochrome PNGs are
tinted and painted by editable Lisp shaders. Bitmap decoding uses the native
[image bitmap API](https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap).

## Build a persistent tree

Import the library explicitly. Constructors return plain mutable dictionaries;
children are ordinary lists. Build the tree once, update its data or handlers,
and render that same tree. There is no virtual tree reconciliation or global UI
instance. Separate calls to `ui-new` create separate interaction state.

```lisp
(await (import "../hg/ui.lisp"))

(let message (ui-label "Hello"))
(let workspace (ui-dock
  (ui-pane "Greeting"
    (ui-vbox
      message
      (ui-button "Click me" (on click (event) {
        (set message.props.value "Clicked!")
      }))))))

(let desktop (ui-new (ui-vbox (gap 0)
  (ui-menu (ui-label "My application"))
  workspace
  (ui-taskbar workspace))))
```

Use [examples/ui.lisp](../examples/ui.lisp) for a complete scene with render,
update, lifecycle, keyboard, pointer, and wheel hooks.

| Constructor                                       | Purpose                                                         |
| ------------------------------------------------- | --------------------------------------------------------------- |
| `(ui-pane title ...items)`                        | Dockable pane; title can be a string or a composed element      |
| `(ui-dock ...panes)`                              | Workspace containing docked and floating panes                  |
| `(ui-vbox ...items)` / `(ui-hbox ...items)`       | Vertical / horizontal layout                                    |
| `(ui-box ...items)`                               | Container whose children share its available bounds             |
| `(ui-scroll ...items)`                            | Scrollable viewport around arbitrary child components           |
| `(ui-label string ...options)`                    | Cached text label                                               |
| `(ui-icon source ...options)`                     | Composable monochrome icon, tinted with its local color         |
| `(ui-button ...items)`                            | Composed content with pointer and keyboard activation           |
| `(ui-textbox string ...options)`                  | Editable single-line text with native input and selection       |
| `(ui-bar ...items)` / `(ui-menu ...items)`        | Horizontally scrollable strip                                   |
| `(ui-dropdown title ...items)`                    | String or composed title opening a popup of ordinary components |
| `(ui-taskbar workspace ...items)`                 | Scrollable strip with restore buttons for minimized panes       |
| `(ui-prop key value)`                             | Explicit component property configuration                       |
| `(ui-config props)` / `(ui-config ...key-values)` | Bulk configuration for programmatic construction                |

Items can include children, configuration, handler values, nested lists of these items,
and nil/false. Strings, including computed strings, become ordinary `ui-label`
children. Arguments evaluate normally before a constructor runs. A loop can
build a native list of children with `insert`; pass that list into the container.
Configuration applies in argument order to its enclosing component. Panes arrange their content in a vertical box;
explicit nested boxes provide other compositions.

All component constructors use the `ui-` prefix, including `ui-label` and
`ui-button` (formerly `label` and `button`).

## Rectangle configuration and composition

Use small configuration forms when declaring a component:

```lisp
(ui-button
  (padding (vec2 10 4))
  (ui-vbox
    (gap 4)
    (align "center")
    (ui-icon "/editor/icons/code.png")
    "This is a button")
  (on click (event) (print "Clicked")))

(ui-hbox
  (padding 8) (gap 6) (v-align "center")
  (ui-icon "/editor/icons/code.png" (size 16) (fill 1 1 1))
  (ui-label "Hello" (font "monospace") (size 14) (fill 1 1 1)))
```

These are ordinary editable Lisp functions returning configuration values.
Construction evaluates them once to configure the persistent component being
built. Nested components have their own configuration.

| Configuration                                          | Meaning                                                          |
| ------------------------------------------------------ | ---------------------------------------------------------------- |
| `(padding value)`                                      | Symmetric padding: scalar or `(vec2 horizontal vertical)`        |
| `(gap value)`                                          | Space between flow children                                      |
| `(width value)` / `(height value)`                     | Explicit rectangle dimensions                                    |
| `(grow value)`                                         | Weight for sharing available space along the parent's flow axis  |
| `(h-align "left"/"center"/"right"/"stretch")`          | Horizontal placement of content                                  |
| `(v-align "top"/"center"/"bottom"/"stretch")`          | Vertical placement of content                                    |
| `(align "center")`                                     | Center content on both axes                                      |
| `(font value)` / `(size value)` / `(fill ...channels)` | Local typography and icon tint                                   |
| `(background color)`                                   | Rectangle background where supported by the component            |
| `(visible bool)` / `(disabled bool)`                   | Component visibility / interaction state                         |
| `(ui-prop "name" value)`                               | Component-specific settings, such as pane IDs and docking limits |

Every property is local and explicit, including font, size, and color. Configure
the label or icon itself for typography; configuring a containing button or box
does not style its descendants. Bare strings use the ordinary label defaults.
The editor theme explicitly styles each leaf, including dynamically created file
rows and taskbar entries, while preserving explicit constructor configuration.
`fill` accepts the same scalar/three/four-channel colors as text. Alignment strings
are ordinary values; quote them or supply a bound string.

All elements expose intrinsic `measured` size, an assigned `bounds` rectangle,
and an intersected `clip` rectangle. A label measures shaped text; an icon
measures its image's aspect ratio. A button measures and arranges children using
the same flow layout as boxes. Its children paint normally; hover, focus, clicks,
and keyboard activation belong to the button. Buttons default to decorative
children (`hit-children: false`); set that property explicitly for a custom
interaction design.

`Layout` in [hg/layout.js](../hg/layout.js) supplies shared padding, rectangle
insetting, and alignment geometry to both text rasterization and Lisp layout.
Horizontal/vertical flow and grow allocation remain editable Lisp. Text shaping,
line breaking, and baselines remain text-specific measurement. In a `text` body,
font/size/fill still configure subsequent spans; in UI construction they configure
the enclosing component's own properties. Both use the same units
and padding/alignment conventions. The text raster's `resolution` and the UI's
device scale control raster density, independently of logical rectangle size.

`Resources.withOrigin(factory, fallbackURL)` is a generic native mechanism used
by the editable `ui-icon` factory. Compiled calls supply their source URL as the
factory's explicit first argument; the public callable still accepts its normal
arguments. Ordinary Lisp aliases retain this behavior. The fallback handles
direct native invocation. `(source-url reference)` explicitly resolves a URL
against the defining program without global source state. Stored icon references
are canonical URLs, so copying an icon into another composition retains its asset.

Bulk configuration remains available:

```lisp
(ui-config (dict "padding" 8 "gap" 4))
(ui-config "padding" 8 "gap" 4) ; equivalent

(ui-node ui-container-component (dict "axis" "y" "padding" 8 "gap" 4) (ui-label "Hello"))
(ui-node ui-container-component "axis" "y" "padding" 8 "gap" 4 (ui-label "Hello")) ; equivalent
```

For `ui-node`, property pairs follow the component dictionary and precede any
children, configuration, or handlers. Keys must evaluate to strings, and values evaluate
normally. Like `dict`, `ui-config` accepts no arguments for empty properties and
fills an unmatched final key with nil. Existing dictionary arguments retain
their normal identity behavior; `ui-node` still copies its properties. `ui-style`
is a compatibility alias for saved projects. Stock labels and buttons no longer
have `icon`, `leading-icons`, or `trailing-icon` slots; compose `ui-icon` children.

Common properties include `w`, `h`, `grow`, `padding`, `gap`, `visible`,
`background`, `disabled`, and `cursor`. Positive `grow` shares available space by weight.
Labels expose `value`; a single-label button also retains its mutable `value`
shorthand. Typography is configured through `font`, `size`, and `color`. Colors are
ordinary float vectors. Nodes expose `props`, `state`, `children`, `handlers`,
`component`, `measured`, `bounds`, and `clip`; bounds/clips are `(x, y, width, height)`.

Labels accept `h-align` as `"left"` (default), `"center"`, or `"right"`, and
`v-align` as `"top"`, `"center"` (default), or `"bottom"`. Pane titles and
buttons center text vertically with their icons, including dropdown and taskbar
buttons. Centering uses visible glyph bounds rather than the font's extra
ascent/descent space. Text origins still snap to device pixels. Text results expose
these raster coordinates as `ink.top` and `ink.bottom`.

Focused or pressed buttons show a full outline using the pane border drawing
helper. `focus-color` controls its color and `border-width` its thickness (2 UI
pixels by default). Disabled buttons omit this outline.

`ui-textbox` emits `change` and `submit` (Enter) events containing `value`.
It uses a monospace cell model for hit testing and selection. Tab moves UI focus;
disabled fields are read-only. `TextProxy.listenKeys` forwards native keyboard
records to Lisp and honors their `prevent-default` field; `TextProxy.readOnly`
sets native editing state without implementing component policy in JavaScript.

Overflowing bars and taskbars show a left/right chevron only where more content
can be scrolled into view. Both ends reserve a stable gutter while overflowing;
items clip to the remaining viewport, which keyboard focus also uses. Wheel
scrolling retains its existing behavior. Indicators are configured through
`scroll-indicator-width` (20 UI pixels), `scroll-indicator-size` (16), and
`scroll-indicator-color`. The two entries in a strip's ordinary `overlays` list
are its left/right indicators. The editor composes `ui-icon` nodes there; stock
bars use editable Lisp shader leaves. Overlay nodes have the same measurement,
arrangement, painting, and mounting lifecycle as other nodes.

Stock components observe their documented properties during layout. Call
`(ui-invalidate desktop)` after other custom state changes that affect painting.
Clean frames reuse the completed GPU image; text textures are cached by content
and presentation properties. Source editing uses a bounded viewport texture.

`desktop.observe` defaults to true, preserving automatic property observation.
Set it to false for explicit invalidation and a cheap idle path, as the editor
does. `ui-invalidate` requests measurement, layout, and painting; `ui-reflow`
requests layout and painting; `ui-repaint` requests painting only. Custom component
events must request the work their state changes need. Routed `on` handlers
invalidate automatically. Pointer movement inside the same component does not
redraw it unless its event callback changes painting state. Direct tree/property
changes in explicit mode require `ui-invalidate`.

Pane movement reuses measurements and arranges only its workspace. Unchanged
subtrees retain their bounds. Docking preview animation requests painting without
remeasuring text. The editor refreshes binding descriptions four times per second
and reuses unchanged inspector rows and label textures. The source editor keeps
spare text texture space so shrinking a pane does not rasterize it again.
The editor host disables expression tracing by default; open `index.html?trace=1`
for detailed runtime source traces. Compilation diagnostics remain available.

`desktop.scale` is the number of device pixels per UI layout unit, defaulting to

1. The editor host sizes its canvas bitmap to the physical display and publishes
   the current ratio in `app.state.pixel-ratio`. The Lisp scene sets `desktop.scale`
   from that value, preserving CSS-sized layout and pointer coordinates at fractional
   display scaling. Stock text rasterizes directly at this density and snaps texture
   origins to whole device pixels. Changing the ratio invalidates text and layout
   caches, including when moving between monitors or changing browser zoom.

Custom components keep bounds and input in UI units. `ui-rectangle` scales using
`node.state.scale`; `(ui-image context texture position clip scale)` accepts the
UI scale explicitly (omitting it defaults to 1). Text textures supplied to
`ui-image` should already be rasterized at that density. `ui-pixel-position`
rounds a physical texture origin to the nearest pixel. Custom shaders and
`TextProxy.caret` receive physical coordinates, as shown by the code editor.

## Scrollable content

The Bindings pane uses [editor/inspector.lisp](../editor/inspector.lisp) inside
`ui-scroll`. Click a row or press Enter/Space to expand or collapse it. Arrow
keys move between rows, open a branch, or return to its parent. Open branches
show current values, including nested dictionary fields and collection entries.
Expansion and page choices persist under `app.state.tools.bindings` with the
workspace. Large collections show 50 entries per page. Previews stop at circular
references, 16 nested levels, or 300 visible rows; collapse branches to free space.
Functions and accessors are never executed for a preview. Native data observations
come from [App.preview](./APP.md#live-binding-reflection); tree behavior stays Lisp.

Wrap content in `ui-scroll` to make it scrollable independently of its pane:

```lisp
(ui-pane "Bindings"
  (ui-scroll
    (ui-prop "scroll-x" true)
    (ui-label summary (font "monospace") (v-align "top"))))

(ui-scroll (height 200)
  (ui-button "First action" (on click () (first-action)))
  (ui-button "Second action" (on click () (second-action))))
```

The viewport fills available space by default (`grow: 1`) and arranges its items
vertically with an 8-unit gap. Wrap items in `ui-hbox`, `ui-vbox`, or `ui-box`
for other compositions. Padding belongs to the viewport; its content and
scrollbar rectangles are ordinary child and overlay nodes. Nested viewports
retain independent offsets. Content outside the viewport is clipped for both
painting and hit testing.

| Property | Default | Meaning |
| --- | --- | --- |
| `scroll-y` | true | Allow vertical overflow |
| `scroll-x` | false | Allow horizontal overflow |
| `scrollbar-size` | 8 | Gutter thickness in UI units; zero hides the bars |
| `scrollbar-min-thumb` | 20 | Minimum thumb length, capped by the track |
| `wheel-line` | 20 | Movement for a line-mode wheel event or arrow key |
| `scroll-state` | nil | Optional shared plain dictionary with numeric `x`/`y` positions |
| `scrollbar-track` | dark gray | Track color |
| `scrollbar-color` | gray | Thumb color |
| `scrollbar-active-color` | light blue | Thumb color while dragging |

Wheel and trackpad input preserve fractional movement and normalize pixel,
line, and page modes. Shift+wheel scrolls horizontally. An inner viewport passes
wheel input to its parent when it cannot move in the requested direction.
Scrollbars support track clicks and dragging outside the viewport. Click a
scrollbar or empty viewport space to focus it, then use arrow keys, Page Up/Down,
Home/End, or Ctrl+Home/End for both axes. Focusing a descendant through Tab
reveals it without taking over its own editing keys.

`(ui-scroll-to desktop viewport (vec2 x y))` clamps the offset, arranges the
content, and requests painting. It returns true when the position changes.
Pass `(ui-prop "scroll-state" saved-position)` to share a plain position record
with application state. Scrolling writes its `x`/`y` fields. Requested positions
survive a temporarily empty viewport while its content loads; the visible offset
is always clamped. Mercury stores these records in `app.state.tools` for refresh.
Offsets and limits live in `viewport.state.offset` and
`viewport.state.max-offset`; `viewport.state.viewport` holds the visible rectangle.
Changing content or resizing the viewport recomputes limits and reclamps offsets.
Scrolling reuses measured content and cached textures. Mercury uses this component
for both Bindings and Diagnostics.

## Clipped shader layers

Stock painting uses `(layer context bounds shader ...arguments)` to compose
straight-alpha shader output into the current target with GPU source-over blending.
Bounds are a physical `vec4` rectangle. `(layer-regions context regions shader
...arguments)` reuses one set of uniforms across a native list of rectangles.
Regions clip at pixel centers and are drawn in order; keep them disjoint to avoid
blending overlapping pixels twice. Pane borders use four narrow regions.

Layers return nil and share a render pass. Their shaders cannot sample automatic
`before` or the texture currently being painted; return a color instead. Existing
ordinary shader calls keep their previous-pass behavior and close the layer pass
before reading its output. Fixed GPU blending stores premultiplied output when
the destination is translucent; the UI uses an opaque background. All component
paint decisions, shaders, and clipping rectangles remain editable Lisp.

`clear` uses an attachment clear rather than a fullscreen shader. A subsequent
layer consumes that clear in its own pass, so a stock UI repaint uses one layer
pass and one presentation pass. Clean frames do not create a command encoder or
submit GPU work. See [performance measurements](./PERFORMANCE.md).

## Component namespaces

A component namespace is a plain dictionary of functions, separate from node
state. `(ui-node component props ...items)` constructs a node with that namespace.
Operations receive their data explicitly:

| Operation           | Arguments            | Result / responsibility                     |
| ------------------- | -------------------- | ------------------------------------------- |
| `measure`           | `ui node`            | Natural `vec2` dimensions                   |
| `arrange`           | `ui node`            | Arrange children with `ui-arrange`          |
| `paint`             | `ui node context`    | Paint the component                         |
| `overlay`           | `ui node context`    | Paint after its children                    |
| `event`             | `ui node name event` | Handle routed input or component events     |
| `mount` / `unmount` | `ui node`            | Acquire / release component-owned resources |
| `tick`              | `ui node context`    | Update component state                      |

Operations are optional. A custom component can compose existing components or
provide these functions entirely in Lisp. `ui-rectangle` and `ui-image` provide
editable Lisp shader helpers. `ui-path`, `ui-hit`, and `ui-event` are also ordinary
library functions.

Editing a component namespace function changes the behavior of nodes sharing it:

```lisp
(set ui-label-component.paint (fn (ui node context)
  ; Your Lisp rendering code here.
))
```

Library imports retain the app's existing module cache contract. Editing a module
file on disk does not automatically reevaluate it in a running app. Reload the
page to fetch the edited library, or replace its live exported functions/data
through Lisp. Source replacement rebuilds editor composition while its document
model and explicitly saved docking layout remain in `app.state`.

## Lifecycle and scene integration

```lisp
(on attach () (ui-mount desktop))
(on detach () (ui-unmount desktop))
(on update (context) (ui-update desktop context))
(on render (context) (ui-render desktop context))
```

Mount automatically registers the tree with its owning app's input routes;
unmount releases that subscription. Scenes need no input-forwarding hooks.
Generic `(listen-input callback)` / `App.listenInput(app, callback)` returns an
unsubscribe function and calls the callback with `name` and a mutable event.
Newest subscriptions run first. `event.handled` stops further routes and the
scene input hook; `prevent-default` separately controls browser behavior. UI
consumes interactive input and leaves unhandled input available to scene hooks.
Scene `on` hooks and the generic `Events` dispatcher remain separate.

Mount runs from parent to child; unmount runs from child to parent. Closing a pane
unmounts its subtree. Minimizing preserves its components and editing state while
hiding it; its bottom-tray button restores it. Other dynamic subtree edits should
explicitly mount/unmount the affected nodes. Resource cleanup stays with owners.

## Nested `on` and ordinary functions

In statement position, scene `on` keeps its existing named-hook contract.
In value position, `(on click (event) ...body)` produces a component handler by
calling the in-scope `ui-on` Lisp function. It does not register a scene callback.
The compiler quotes the event name and compiles the function; the Lisp library
owns the handler representation and all dispatch policy. Import the library's
bindings, or define a local `ui-on` when using a namespaced import.

Explicit `(on click (fn (event) ...))`, function values, and async-wrapped
functions are supported. Use ordinary `(ui-on "click" handler)` when convenient.

Events bubble from the target toward the root. `target`, `current-target`, `name`,
and `ui` accompany the original input fields. Set `event.stop` to stop propagation
and `event.prevent-default` to suppress the library's default action. Handler
return values do not cancel dispatch. Async handlers retain their normal promise
behavior; handle their rejection explicitly. Buttons activate on primary release
over the pressed button or Enter/Space. Canvas Tab cycles eligible components
and reveals focused strip items; native text input retains its editing keys.
Dropdowns close on item activation, outside pointer presses, or Escape.

Ordinary host functions now support a final `&rest` parameter:

```lisp
(let container (fn (title &rest children) ...body))
```

It collects remaining arguments into a native list, empty when omitted. An
optional annotation must be `list`. It also works in async functions; WGSL
functions and fixed-arity scene hooks do not accept rest parameters. `(keys dict)`
returns a native list of own string keys in ordinary JavaScript property order.

Keyboard/wheel snapshots expose `prevent-default`; a synchronous scene handler
can set it to true to cancel the browser action. Wheel snapshots now include
inner-pixel `x`, `y`, and `inside` so Lisp can route scrolling to the right strip
or content area. `TextProxy.blur` releases native text focus without disposal.

`(cursor "ew-resize")` sets the owning canvas's CSS cursor. `(cursor nil)` releases
that override and restores its previous inline cursor; disposal does the same.
The primitive belongs to the app's input service. All UI cursor selection stays
in Lisp through `ui-update-cursor` and the shared `ui-dock-hit` resize hit query.
Cursor release is also safe during scene cleanup after input disposal.

## Docking and resizing

Paned workspaces keep an ordinary binary split tree. Initial panes are docked
side by side. A title-handle press leaves the pane in place; moving beyond
`drag-threshold` starts dragging and floats a docked pane. Releasing before that
threshold leaves its docking and dimensions unchanged. Undocking removes `undock-shrink` from each horizontal side and
`undock-shrink-bottom` from the bottom, respecting minimum sizes and retaining the grab
within the title. Already-floating panes keep their size when dragged. Dockable
panes can also start floating with `(ui-prop "floating" true)`, or closed with
`(ui-prop "closed" true)`. `ui-pane-open` raises an existing pane, restores a
minimized pane, or remounts a closed pane as a floating window. Saved layout
state takes precedence over these initial settings. Floating panes paint above
docked panes. A floating pane resizes from every edge and corner.
Dragging a shared edge changes only the panes touching that edge. Other parallel
dividers retain their position; adjacent nested ratios are adjusted to preserve
those positions. Minimum sizes constrain the affected panes, and cancellation
restores the original ratios. A four-pixel hit margin remains on both sides even
when the visible divider gap is zero.
When the viewport cannot fit all minima, the existing layout compresses to fit.

Panes have a contrasting 2-UI-pixel outline painted over their children. Docked
neighbors share that width rather than doubling it. Hovering
a floating resize region highlights its border and shows `ew-resize`, `ns-resize`,
`nwse-resize`, or `nesw-resize` for the matching edge/corner. Shared dividers show
`col-resize` or `row-resize` and highlight on hover. The cursor stays matched to
the operation while dragging and resets when it ends or the pointer leaves.
Headers use `grab`/`grabbing`, buttons use `pointer`, and source text uses `text`.
Popups and covered floating contents take precedence over resize regions below
them. Docked outer edges have borders but only shared dividers resize the dock tree.

Dragging near the left/right/top/bottom edge of a docked pane outlines the proposed
split. Holding within the same target and a small pointer tolerance waits briefly,
then fills that rectangle gradually. At readiness, the fill and outline change color. Release
then commits the split. Release early leaves the pane floating. Moving beyond the
tolerance or changing the target resets readiness immediately. The visible fill
animates back toward zero instead of snapping, then catches up as a new dwell
builds. Leftover visual fill cannot make a new target ready sooner. Leaving a
target continues draining the fill while its preview is hidden. Pointer cancellation
restores the original layout or dimensions. An empty workspace uses its whole area as a
dwell target. A new split requires enough space for both panes' minima.

Editable workspace properties:

- `dwell-delay`: 0.15 seconds of stable hover before filling; resets with readiness.
- `dwell`: 0.6 seconds of filling after the delay (0.75 seconds total by default).
- `dwell-decay`: 0.2 seconds to drain a full preview fill to zero.
- `hold-radius`: 6 pixels of pointer tolerance.
- `drag-threshold`: 6 UI pixels before a handle press becomes a drag.
- `undock-shrink`: 32 UI pixels removed from each horizontal side when undocking.
- `undock-shrink-bottom`: 64 UI pixels removed from the bottom; the title stays in place.
- `divider`: 0 pixels of extra gap between stock docked panes; resize hit areas stay wider.
- `preview-background`, `preview-outline`, `preview-fill`, `preview-ready`,
  `preview-ready-outline`, `divider-color`, and `divider-hover-color`: editable colors.

Pane properties include `min-w`/`min-h` (220/100), `float-w`/`float-h` (420/320),
`title`, `id`, `border-width` (2), `border-color`, `border-hover-color`, and
`border-active-color`. Use distinct stable IDs if titles can change.
Minimizing a docked pane retains its slot and split ratios in the tree. Its hidden
branch consumes no space or divider, so visible neighbors fill the available
area. Restoring returns it to that slot, including when several panes are restored
in a different order. Floating panes retain their position and size and restore
as floating panes. Hidden slots persist in saved layouts and cannot be docking
targets; an entirely minimized workspace still offers its full area for docking.
Older saved layouts without a minimized pane's slot restore it beside the current
dock tree. Closing removes its subtree and slot; reset/rebuild the layout to create
it again.

For source replacement, construct a new tree in `attach` and assign it to the
scene's UI binding, as the editor and complete example do. Keep document/layout
data explicitly in `app.state`. A candidate scene then owns its own mounted tree
while the previous scene retains its own resources until detach. Persistence
within redraws does not require sharing a mounted tree between scene lifetimes.

Pass a plain `layout` dictionary to the workspace to retain docking through editor
replacement. `ui-dock-save` writes split IDs/ratios, floating rectangles, and
minimized/closed flags into that dictionary after committed interaction changes.
It contains no functions, native resources, or component references and can use
native JSON. This is explicit app data; it does not save to disk or browser storage.

Minimized tray buttons are draggable. Horizontal dragging reorders them, storing
the order by pane ID in the saved layout. Moving more than eight UI pixels out of
the tray vertically restores the pane as a floating drag; normal docking dwell
still applies if it is held over a target. Clicking without dragging restores its
saved docking location. Escape from the canvas or pointer cancellation restores
the prior tray order and minimized state. The requested reorder behavior applies
to tray buttons; workspace title drags keep the existing split-docking behavior.

Overflowing titles use a clipped marquee on hover, for docked/floating handles
and minimized tray buttons. It waits 0.6 seconds, scrolls at 30 UI pixels per
second, pauses at the ends, and resets on leaving. `marquee-delay`, `marquee-speed`,
and `title-width` are ordinary editable properties. Icons remain fixed while text
scrolls. This animation reuses text textures and only requests painting.

## Editor composition

[editor/main.lisp](../editor/main.lisp) composes a scrollable top menu, Files,
Source, Bindings, and Diagnostics panes, and the scrollable minimized-pane tray.
[editor/code-editor.lisp](../editor/code-editor.lisp) implements syntax coloring,
line numbers, selection, caret, pointer selection, scrolling, and native input.
The host [index.js](../index.js) supplies the canvas and loads the Lisp entry point.

The editor keeps its document in `app.state.editor` and layout in `app.state.layout`.
Document state includes the anchor/head selection, scroll row, horizontal
`scroll-x` offset in UI pixels, and focus flag.
Rebuilding the editor scene preserves those values and restores native text input focus after the
new component's layout, so typing can continue at the same caret position.
The Project menu offers New/Open/Save Project, Save now, Reload editor, Resume project editor,
Restore default editor, Reopen saved file, Refresh files, Reset draft,
Reset layout, and Restore minimized panes. The Live editor toggle controls rebuilding
editor/library code after autosave; project files are only edited and saved.
Autosave uses a 400 ms delay and waits for IME composition to finish. One document
buffer saves before switching files. The Files pane, filename prompts, deletion
confirmation, and image previews are all ordinary Lisp. Right-click a file or
folder to select it and open a context menu with Open or Expand/Collapse,
New file, New folder, Rename, and Delete. Deletion uses the existing confirmation.
Previews open in their
own floating pane and leave the Source pane's code, selection, and scroll intact.
Drag to pan, use the wheel for pointer-centered zoom, or select Fit / 1:1.
Fit enlarges or shrinks the image to the preview area while preserving its aspect ratio.
The preview has a checkerboard background and nearest-pixel sampling for sharp pixels.
See the
[filesystem API](./FILESYSTEM.md). All visible components and UI behavior
are editable Lisp. Horizontal trackpad deltas and Shift+wheel scroll source
columns while line numbers stay fixed. Keyboard movement and typing reveal the
active column; selection, pointer hit testing, and native caret placement follow
the horizontal viewport. Source textures keep a bounded horizontal raster window
with spare space, reusing it between window changes. The native text snapshot's
`max-columns` field supplies the longest line's UTF-16 length without materializing
every lazy line record. Column positions retain the editor's monospace cell model.
Assets > Asset base URL configures internal-first resource fallback. F2 enters
the default recovery editor without changing project files. Project save/open and
backup/restore behavior are ordinary Lisp; see the filesystem reference above.
Precise variable-width text geometry, local-folder mounts, tabs for multiple documents,
and nested preview apps remain later work.
