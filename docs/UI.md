# Composable Lisp UI

The UI library is [hg/ui.lisp](../hg/ui.lisp). Components, layout, painting,
hit testing, event routing, focus, scrolling, docking, and resizing are ordinary
Lisp. The engine supplies compilation, textures, canvas input, and invisible
native text editing. It does not implement JavaScript widgets or visible DOM UI.

The current implementation is a prototype. The headless Chrome profiler exercises
startup, hovering, typing, and pane dragging, including a large document. The full
editor test suite has not been run against this rewrite.

## Build a persistent tree

Import the library explicitly. Constructors return plain mutable dictionaries;
children are ordinary lists. Build the tree once, update its data or handlers,
and render that same tree. There is no virtual tree reconciliation or global UI
instance. Separate calls to `ui-new` create separate interaction state.

```lisp
(await (import "../hg/ui.lisp"))

(let message (label "Hello"))
(let workspace (ui-dock
  (ui-pane "Greeting"
    (ui-vbox
      message
      (button "Click me" (on click (event) {
        (set message.props.value "Clicked!")
      }))))))

(let desktop (ui-new (ui-vbox (ui-style (dict "gap" 0))
  (ui-menu (label "My application"))
  workspace
  (ui-taskbar workspace))))
```

Use [examples/ui.lisp](../examples/ui.lisp) for a complete scene with render,
update, lifecycle, keyboard, pointer, and wheel hooks.

| Constructor | Purpose |
| --- | --- |
| `(ui-pane title ...items)` | Titled dockable pane with drag handle, minimize, and close controls |
| `(ui-dock ...panes)` | Workspace containing docked and floating panes |
| `(ui-vbox ...items)` / `(ui-hbox ...items)` | Vertical / horizontal layout |
| `(ui-box ...items)` | Container whose children share its available bounds |
| `(label string ...options)` | Cached text label |
| `(button string ...options)` | Pointer and keyboard activation |
| `(ui-bar ...items)` / `(ui-menu ...items)` | Horizontally scrollable strip |
| `(ui-dropdown title ...items)` | Button opening a popup of ordinary components |
| `(ui-taskbar workspace ...items)` | Scrollable strip with restore buttons for minimized panes |
| `(ui-style props)` | Property options using an ordinary dictionary |

Items can include children, styles, handler values, nested lists of these items,
and nil/false. Arguments evaluate normally before a constructor runs. A loop can
build a native list of children with `insert`; pass that list into the container.
Styles apply in argument order. Panes arrange their content in a vertical box;
explicit nested boxes provide other compositions.

Common properties include `w`, `h`, `grow`, `padding`, `gap`, `visible`,
`background`, `disabled`, and `cursor`. Positive `grow` shares available space by weight.
Labels/buttons also expose `value`, `font`, `size`, and `color`. Colors are
ordinary float vectors. Nodes expose `props`, `state`, `children`, `handlers`,
`component`, `measured`, `bounds`, and `clip`; bounds/clips are `(x, y, width, height)`.

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
and keeps spare text texture space so shrinking a pane does not rasterize it again.
The editor host disables expression tracing by default; open `editor.html?trace=1`
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

| Operation | Arguments | Result / responsibility |
| --- | --- | --- |
| `measure` | `ui node` | Natural `vec2` dimensions |
| `arrange` | `ui node` | Arrange children with `ui-arrange` |
| `paint` | `ui node context` | Paint the component |
| `overlay` | `ui node context` | Paint after its children |
| `event` | `ui node name event` | Handle routed input or component events |
| `mount` / `unmount` | `ui node` | Acquire / release component-owned resources |
| `tick` | `ui node context` | Update component state |

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
(on pointerdown (event) (ui-input desktop "pointerdown" event))
(on pointermove (event) (ui-input desktop "pointermove" event))
(on pointerup (event) (ui-input desktop "pointerup" event))
(on pointercancel (event) (ui-input desktop "pointercancel" event))
(on pointerleave (event) (ui-input desktop "pointerleave" event))
(on wheel (event) (ui-input desktop "wheel" event))
(on keydown (event) (ui-input desktop "keydown" event))
(on keyup (event) (ui-input desktop "keyup" event))
```

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
threshold leaves its docking and dimensions unchanged. Undocking reduces width
and height by `undock-shrink`, respecting minimum sizes and retaining the grab
within the title. Already-floating panes keep their size when dragged. Floating
panes paint above docked panes. A floating pane resizes from every edge and corner.
Shared dock dividers resize the two branches while respecting their recursive minimum sizes.
When the viewport cannot fit all minima, the existing layout compresses to fit.

Panes have a contrasting 2-UI-pixel outline painted over their children. Hovering
a floating resize region highlights its border and shows `ew-resize`, `ns-resize`,
`nwse-resize`, or `nesw-resize` for the matching edge/corner. Shared dividers show
`col-resize` or `row-resize` and highlight on hover. The cursor stays matched to
the operation while dragging and resets when it ends or the pointer leaves.
Headers use `grab`/`grabbing`, buttons use `pointer`, and source text uses `text`.
Popups and covered floating contents take precedence over resize regions below
them. Docked outer edges have borders but only shared dividers resize the dock tree.

Dragging near the left/right/top/bottom edge of a docked pane outlines the proposed
split. Holding within the same target and a small pointer tolerance fills that
rectangle gradually. At readiness, the fill and outline change color. Release
then commits the split. Release early leaves the pane floating. Moving beyond the
tolerance or changing the target resets readiness immediately. The visible fill
animates back toward zero instead of snapping, then catches up as a new dwell
builds. Leftover visual fill cannot make a new target ready sooner. Leaving a
target continues draining the fill while its preview is hidden. Pointer cancellation
restores the original layout or dimensions. An empty workspace uses its whole area as a
dwell target. A new split requires enough space for both panes' minima.

Editable workspace properties:

- `dwell`: 0.6 seconds by default.
- `dwell-decay`: 0.2 seconds to drain a full preview fill to zero.
- `hold-radius`: 6 pixels of pointer tolerance.
- `drag-threshold`: 6 UI pixels before a handle press becomes a drag.
- `undock-shrink`: 32 UI pixels removed from each dimension when undocking.
- `divider`: 6 pixels between docked branches.
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

## Editor composition

[editor/main.lisp](../editor/main.lisp) composes a scrollable top menu, Source,
Bindings, and Diagnostics panes, and the scrollable minimized-pane tray.
[editor/code-editor.lisp](../editor/code-editor.lisp) implements syntax coloring,
line numbers, selection, caret, pointer selection, scrolling, and native input.
The host [editor.js](../editor.js) supplies the canvas and loads the Lisp entry point.

The editor keeps its document in `app.state.editor` and layout in `app.state.layout`.
It offers explicit Apply, Reset draft, Reset layout, Restore minimized panes, and
an auto-reload toggle. Auto reload defaults on with the existing 400 ms debounce
and waits for IME composition to finish. All visible components and UI behavior
are editable Lisp. Source-column scrolling, precise variable-width text geometry,
disk saving, tabs for multiple documents, and nested preview apps remain later work.
