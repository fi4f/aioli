# Mayo canvas editor contracts

Mayo's visible UI is drawn exclusively through the WebGPU canvas. A native
browser textarea supplies invisible input services; it has zero opacity and
cannot receive pointer events. Offscreen text rasterization is uploaded and
composed through the existing GPU path.

## Runtime context: aioli

The `aioli` dictionary exposes `source`, `source-url`, `state`, `reload`, and `tokenize`.
Scene code sees its candidate source during initialization. Imported modules
see the runtime context. State is a runtime-scoped Lisp dictionary surviving
scene replacement, intended for document data rather than resource handles.

`(aioli.reload source)` returns a promise and queues compilation after the
current callback returns. It retains the entry point's source URL, allowing
relative imports and source-located diagnostics. Syntax and top-level execution
failures reject with formatted traces while leaving the previous scene installed.
Successful replacement publishes the new source and uses the ordinary Stage
lifecycle. With tracing enabled, self-reload attaches the candidate and checks
its first render before discarding the working scene. A synchronous attach or
first-render error rejects reload, disposes the candidate, and reattaches the
working scene so its Lisp error handler can display the diagnostic. The
candidate's attach runs once on success. Untraced self-reloads use ordinary
replacement and may stop their Stage on a runtime error.
Initialization side effects are not rolled back. Errors on later frames and
asynchronous GPU failures are not yet contained by this first-render check.
Imported modules retain their cache in this MVP.

`(aioli.tokenize source)` returns a list of rows, each containing a list of
token dictionaries with `kind`, `text`, `start`, and `end`. Offsets are UTF-16,
and token text preserves source exactly (newlines separate the returned rows).
Categories describe lexical syntax, not resolved bindings or semantic types.
The shared scanner supplies compiler boundaries and accepts incomplete edits
for tooling, while the reader still validates syntax strictly. Template strings
currently receive one string color, including their interpolation expressions.
Mayo caches tokens by source and chooses all colors in its Lisp palette.

## Invisible input: text-proxy

`(text-proxy callback)` returns a language dictionary with these operations:

- `(proxy.sync source anchor head)` mirrors the Lisp document and selection.
  Offsets use UTF-16 and are snapped to grapheme boundaries. CRLF becomes LF.
- `(proxy.snapshot)` returns the current input snapshot.
- `(proxy.focus)` routes native typing and composition to the invisible proxy.
- `(proxy.select row column extend)` mirrors a selection chosen by Lisp.
  Row and column are zero-based; column is a UTF-16 offset. Extend preserves
  the selection anchor. Positions clamp to the document and grapheme boundaries.
- `(proxy.caret position height)` positions the platform IME anchor in inner
  canvas coordinates. It draws nothing.
- `(proxy.dispose)` releases the native surface and listeners. It is idempotent.

Snapshots contain `content`, `anchor`, `head`, `composing`, and a `lines` list.
Each line contains `text`, `start`, `end`, `caret`, `selection-start`, and
`selection-end`. Caret is a line-relative offset or -1. Selection columns are
clamped to that line; offsets count UTF-16 code units.

The callback receives complete snapshots after input and native selection changes,
including composition start and end. This avoids introducing top-level string
editing bindings for the first demo. Lisp keeps its own document and selection
state, uses `sync` to make programmatic changes, and draws snapshots itself.
Native editing supplies typing, deletion, paste, keyboard selection, and IME.
Tab inserts two spaces. Pointer hit testing and scrolling belong to Lisp.
Mayo preserves fractional scroll positions, interprets wheel pixel/line/page
units, and clips partially visible rows to the source viewport. Scrolling stops
at the last viewport of the document. Only document or selection changes reveal
the caret; composition-only notifications preserve manual scroll position.

Mayo creates its proxy during attach and disposes it during detach. Runtime
shutdown also disposes remaining proxies. Native composition finishes before
Mayo requests replacement, and replacement recreates the proxy from shared state.

## Lisp-owned behavior

`editor/main.lisp` renders source lines, selection rectangles, the caret, title,
and diagnostics. Highlighted code and a right-aligned, dynamically sized
line-number gutter are batched into the same texture. Gutter columns are excluded
from selection ranges and pointer-to-source column calculations.
It handles pointer selection, scrolling, and keeping the caret
visible. It accumulates `update.dt` after content edits and requests one reload
after 0.4 seconds, unless composition is active. Selection-only changes do not
request reload. Source, selection, and scroll position survive replacement.
The host supplies a canvas and boots the Lisp entry point; it has no editor UI.
Unchanged editor frames reuse the last completed GPU image. The visible source
is batched into one bounded text texture using `(wrap false)` and fixed line
height. One GPU pass composes its selection backgrounds, text, and caret. The
texture is cached across selection changes and fractional scrolling within the
same first row. Native notifications with unchanged
text, selection, and composition state are suppressed. The proxy caches line
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

The editor changes its own running source in memory. Disk saving, horizontal
scrolling, reload-stable undo, automatic source formatting, multiple documents, and
independent preview applications are later work. Browser tests exercise canvas-only
UI, reload, syntax-error recovery, native typing, selection restoration, IME
reload deferral, pointer focus, gutter formatting, and syntax color spans.
The demo source itself includes explanatory comments and consistent spacing.
Runtime tests check queued replacement,
candidate source visibility, persistent state, and source-located errors.
