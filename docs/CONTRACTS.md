# Mayo canvas editor contracts

Mayo's visible UI is drawn exclusively through the WebGPU canvas. A native
browser textarea supplies invisible input services; it has zero opacity and
cannot receive pointer events. Offscreen text rasterization is uploaded and
composed through the existing GPU path.

The editor is now composed from the ordinary Lisp [UI library](./UI.md): a
scrollable menu, resizable/dockable Source, Bindings, and Diagnostics panes, and
a horizontally scrollable minimized-pane tray. Dock previews use a dwell timer,
progress fill, and ready color before release commits a split. Floating panes
resize from all edges/corners; dock dividers resize shared branches.

## Runtime: App namespace and app data

Mercury exposes `App` directly in Lisp; JavaScript uses `hg.App`. Operations take
app data explicitly. The current executing app is supplied as the `app` binding,
with `source`, `sourceURL`, and the existing `state` dictionary. It is not a global
current-app selector. Editor replacement uses the captured `(patch-source source)` shorthand;
lexical coloring uses `(App.tokenize app source)`. See [App contract](./APP.md).

The JS host starts the editor from its URL with `App.load`. Patches preserve top-level data
bindings by name and rebuild function/shader definitions and callbacks. The
attach callback rebuilds the composition and native proxy. The document model
stays in `app.state.editor`; plain docking layout stays in `app.state.layout`.

The traced candidate checks and retained module/state behavior remain. Text-proxy
operations use `TextProxy` and an explicit record. Native editing redesign and program exports are deferred.
Token rows/spans remain fresh mutable language snapshots, built lazily through explicit reads
from the compiler's shared incremental scanner.

## Invisible input: text-proxy

`(text-proxy callback)` returns an owned plain editing record. Namespace operations take it explicitly:

- `(TextProxy.sync proxy source anchor head)` mirrors the Lisp document and selection.
  Offsets use UTF-16 and are snapped to grapheme boundaries. CRLF becomes LF.
- `(TextProxy.snapshot proxy)` returns the current input snapshot.
- `(TextProxy.focus proxy)` routes native typing and composition to the invisible proxy.
- `(TextProxy.blur proxy)` releases native text focus without disposing the proxy.
- `(TextProxy.select proxy row column extend)` mirrors a selection chosen by Lisp.
  Row and column are zero-based; column is a UTF-16 offset. Extend preserves
  the selection anchor. Positions clamp to the document and grapheme boundaries.
- `(TextProxy.caret proxy position height)` positions the platform IME anchor in inner
  canvas coordinates. It draws nothing.
- `(TextProxy.dispose proxy)` releases the native surface and listeners. It is idempotent.

Snapshots contain `content`, `anchor`, `head`, `composing`, and a `lines` list.
Each line contains `text`, `start`, `end`, `caret`, `selection-start`, and
`selection-end`. Caret is a line-relative offset or -1. Selection columns are
clamped to that line; offsets count UTF-16 code units.

The callback receives complete snapshots after input and native selection changes,
including composition start and end. This avoids introducing top-level string
editing bindings for the first demo. Lisp keeps its own document and selection
state, uses `sync` to make programmatic changes, and draws snapshots itself.
Native editing supplies typing, deletion, paste, keyboard selection, and IME.
Above 65,536 UTF-16 code units the native surface holds an 8,192-unit window
around the caret to bound browser layout cost. The proxy retains the complete
source and global selection, including document-wide copy, cut, and replacement.
Large-document undo/redo retains up to 64 edit snapshots until `sync` or disposal;
consecutive characters currently undo separately. Small documents use native
browser history. Composition retains its native window until it finishes.
Row snapshots build lazily from compact newline offsets and remain stable after
later edits. Mayo locates the caret by binary search through those offsets.
Tab inserts two spaces. Pointer hit testing and scrolling belong to Lisp.
Mayo preserves fractional scroll positions, interprets wheel pixel/line/page
units, and clips partially visible rows to the source viewport. Scrolling stops
at the last viewport of the document. Only document or selection changes reveal
the caret; composition-only notifications preserve manual scroll position.

The code-editor component creates its proxy during mount and disposes it during
unmount, including pane close and scene detach. Minimizing retains the component
and proxy without text focus. Runtime
shutdown also disposes remaining proxies. Native composition finishes before
Mayo requests replacement, and replacement recreates the proxy from shared state.

## Lisp-owned behavior

`editor/main.lisp` composes the editor, menus, panels, and reload policy.
`editor/code-editor.lisp` renders source lines, selection rectangles, and the caret.
Highlighted code and a right-aligned, dynamically sized
line-number gutter are batched into the same texture. Gutter columns are excluded
from selection ranges and pointer-to-source column calculations.
It handles pointer selection, scrolling, and keeping the caret
visible. With auto reload enabled, the main composition accumulates `update.dt`
after content edits and requests one reload after 0.4 seconds, unless composition
is active. Apply source is also explicit. Selection-only changes do not
request reload. Source, selection, and scroll position survive replacement.
The host supplies a canvas and boots the Lisp entry point; it has no editor UI.
It sizes the canvas bitmap in device pixels and updates `app.state.pixel-ratio`
when the display density changes. The Lisp UI retains CSS-sized layout units,
rasterizes text at that density, and snaps texture origins to device pixels.
Pointer input is converted to UI units; native caret positioning converts back
to physical coordinates before the existing canvas-to-CSS mapping.
Unchanged editor frames reuse the last completed GPU image. The visible source
is batched into one bounded text texture using `(wrap false)` and fixed line
height. One GPU pass composes its selection backgrounds, text, and caret. The
texture is cached across selection changes and fractional scrolling within the
same first row. Native notifications with unchanged
text, selection, and composition state are suppressed. Input requests coalesce
into a render after the callback, rather than waiting for the next animation
tick. Simulation time still advances only through the usual app loop.
Clean frames skip GPU presentation unless outer-canvas sizing changed.
Text measurements and zero-offset, unstroked glyph strips use bounded per-runtime
caches; complex offsets, strokes, or resampling retain the ordinary raster path.
The proxy caches line
indices by content and avoids rewriting unchanged IME positioning styles.

## Text rendering remains a joint design decision

The agreed addition is `(wrap false)`, separating fixed-width clipping from
automatic wrapping. Wrapping remains enabled by default. No layout fields,
hit-test functions, or new text measurement bindings have been introduced.
The MVP estimates a monospace cell
width using the difference between existing single-character and repeated-character
text texture widths. Pointer positions and selection rectangles consequently
assume a fixed-width font. This does not provide accurate variable-width,
bidirectional, emoji, or tab layout. Precise measurement and editing geometry
need to be designed with the project owner before further extending `(text)`.

## Current scope and verification

The editor changes its own running source in memory. Disk saving, source-column
scrolling, reload-stable undo, automatic source formatting, multiple documents,
and independent preview applications are later work. Menu and taskbar horizontal
scrolling are implemented. The Lisp sources compile to JavaScript/WGSL; browser
behavior and the existing tests have not been verified against this composition
rewrite. Historical editor browser fixtures refer to the previous prototype's
layout and bindings and need migration before serving as its acceptance checks.
