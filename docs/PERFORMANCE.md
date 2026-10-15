# Mercury performance measurements

## Editor startup, October 15, 2026

The HTML host paints a loading status before the JavaScript runtime arrives,
updates it while opening the project and restoring the workspace, and hides it
after the editor's first render. Startup failures replace it with the existing
native recovery diagnostics.

Startup now reuses the pristine files already downloaded for initialization
instead of fetching the filesystem, project, and bootstrap modules again.
Four module-preload hints shorten the runtime dependency waterfall. Theme icons
decode and upload concurrently rather than awaiting each icon in sequence.

Measured in isolated headless Chrome at 1280 x 800, with HTTP caching disabled
and an artificial 60 ms delay per request:

| Measurement | Before | After |
| --- | ---: | ---: |
| First load: first contentful paint | 796 ms | 228 ms (loading status) |
| First load: editor ready | 1341 ms | 959 ms |
| Two refreshes: editor ready | 1129–1358 ms | 719–758 ms |
| Requests per load, excluding the document | 78 | 75 |

These are three local samples per version; the first load starts with an empty
project store, while refreshes retain it. Contentful paint includes the loading
status; editor readiness is measured separately after scene loading and the
validated first render. Network, GPU, and saved editor contents affect startup.
Browser checks cover loading before the host module arrives, a rendered canvas
after dismissal, cached recovery when editor downloads fail, and fatal startup
diagnostics, alongside the existing recovery and session checks.

## Composable editor, October 11, 2026

Profiled the real Lisp editor in isolated headless Chrome on this machine's Intel
Xe-LPG adapter: 1100 x 800 CSS pixels, 125% scaling, 1375 x 1000 bitmap pixels.
Expression tracing is disabled by default in the editor; append `?trace=1` to
enable detailed runtime traces. Auto reload is disabled only during profiling.

An early traced run measured 2.61 ms mean idle animation callbacks and 6.30 ms
mean drag callbacks, with a 23.8 ms drag maximum. Chrome's emulated DPR initially
left the bitmap at 1100 x 800; the profiler now corrects that to physical pixels.
Those early numbers are directional, not a controlled same-bitmap comparison.

The optimization pass, before the theme/taskbar additions, measured:

| Workload | Animation callback mean | CPU work per frame mean | CPU work p95 | CPU work maximum |
| --- | ---: | ---: | ---: | ---: |
| Idle | 0.21 ms | 0.12 ms | 0.20 ms | 0.40 ms |
| Hovering menus | 0.12 ms | 0.63 ms | 2.50 ms | 3.20 ms |
| Dragging/releasing a pane | 0.35 ms | 1.19 ms | 2.90 ms | 6.40 ms |

CPU work sums update, graphics (including presentation), and input callbacks
between animation frames, avoiding double-counting nested callbacks. It includes
immediate input redraws, which animation callback timing alone misses. It excludes
native editing before the proxy callback, browser scheduling/compositing, and GPU
execution. The largest graphics redraw in this drag run was 2.8 ms.

A separate timestamp-query run measured 0.97 ms mean GPU render-pass time and
0.98 ms maximum during dragging (four samples). Timestamp privacy quantization
and this small sample count limit precision. The interval spans the first render
pass through presentation, excluding text-upload work before those passes and
physical display latency. After adding the theme, icons, and marquee, a traced
run averaged 0.37 ms idle animation callbacks. The final default-mode run averaged
0.32 ms idle callbacks and 2.65 ms of total CPU work per frame during dragging
(p95 7.80 ms), including immediate input redraws. This is still above the active
frame target.

Repainting uses **2 GPU passes and 2 full-size render textures** across alternating
frame pools, down from 44 passes and 86 pool textures. The initial black texture,
text textures, icon textures, and browser canvas surfaces are additional resources.
Clean frames create no command encoder and submit no GPU work.

### What changed

- Component logic, layout, input, shaders, and caching decisions remain editable Lisp.
- The editor opts into explicit invalidation; automatic observation stays the
  library default. Dragging reflows only its workspace and reuses measurements.
- Node/namespace comparisons use identity without traversing component graphs.
- Binding descriptions refresh at 4 Hz and redraw only when their text changes.
- Clipped layers share a pass, border strips avoid shading pane interiors,
  covered workspace backgrounds are skipped, and attachment clearing joins the pass.
- Uniform arrays, texture views, presentation groups, and selection buffers are reused.
- Text spans are indexed once rather than scanned in full for every rasterized line.
- Spare viewport texture capacity prevents rerasterizing on undocking/shrinking.

Horizontal source scrolling was added after these measurements. It uses a bounded
source raster window and a separate cached gutter texture in the same shader layer.
Small horizontal moves reuse both textures; crossing a raster-window boundary
rerasterizes source text. This path has not yet been profiled.

The filesystem pane, IndexedDB autosave, and fresh editor-module reloads were
also added after these measurements and have not been profiled. The file tree
clips rows, but currently measures expanded entries when its index changes.

**The full <1 ms target is not met for every frame.** Idle work meets it; active
CPU work and text-edit redraws still exceed it. Rasterization, upload, and allocation
remain typing costs. A 20,000-comment-line workload, editing at row 12,000 then
removing 30 characters, measured 10.95 ms mean, 17.20 ms p95, and 19.80 ms maximum
input-to-submission latency. Large-file idle CPU work averaged 0.15 ms; dragging
averaged 1.60 ms including input-triggered redraws. Runs had no console/GPU errors.
No automated test suite was run. Cold initialization, other GPUs/viewports,
custom components, and a future embedded project can have different costs.

### Recorded UI interactions

The extended workload, in both tracing modes, retained selection anchor/head
120/121 and native text focus across reload, with one input subscription afterward.
Moving the Bindings/Diagnostics edge by 40 UI pixels kept Source's width at 366.67;
Bindings/Diagnostics changed by +40/-40. Taskbar ordering changed from
Source/Bindings/Diagnostics to Bindings/Diagnostics/Source. Dragging Bindings out
made it visible and floating. An overflowing title scrolled roughly 13 pixels on
hover and reset to zero on leave. These observations are recorded by the profiler;
they are not a complete regression suite.

## Historical editor measurements

Measured on October 8, 2026 in headless Chrome on the development machine,
with Aioli tracing enabled. These are local measurements, not guarantees for
other machines. The editor still renders all visible UI through WebGPU.

| Workload | Mean input to submission | 95th percentile | Maximum |
| --- | ---: | ---: | ---: |
| Editor source, 35 ms between characters | 4.34 ms | 6.70 ms | 9.30 ms |
| Source plus 20,000 comment lines, 35 ms between characters | 5.05 ms | 7.70 ms | 11.50 ms |
| Same large file, row 12,000, 5 ms between characters, then deletions | 4.47 ms | 6.50 ms | 8.90 ms |

The large-file workload measured 1.06 ms mean native input processing and
0.56 ms mean tokenization when editing at the start. Editing farther down
measured 0.97 ms mean tokenization. Changing a multiline string or comment
boundary can invalidate more lexical state than these workloads do.

## Style rewrite measurements

Measured again on October 10, 2026 in headless Chrome on the development machine,
with Mercury tracing enabled and explicit namespace/storage operations. Each run
typed the same 51-character comment with 35 ms between characters.

| Workload | Mean input to submission | 95th percentile | Maximum |
| --- | ---: | ---: | ---: |
| Editor source | 4.74 ms | 6.70 ms | 7.50 ms |
| Source plus 20,000 comment lines | 5.47 ms | 8.50 ms | 10.30 ms |

The large-file run measured 0.61 ms mean tokenization. These individual runs are
in the same latency range as the earlier measurements; they are not a controlled
before/after comparison. The profiling script now replaces functions in the app's
service namespaces and passes service records explicitly.

## Reproduction

Provide Playwright and installed Chrome, then run:

```powershell
node hg/tools/profile-mercury.cjs
```

The tool starts its own loopback server on a free port and closes it and Chrome
when finished. Set `AIOLI_URL` to use an existing server instead. It loads the
actual editor, disables auto reload for measurement, and runs idle, hover, typing,
and drag workloads. `profile-mercury-typing.cjs` uses the same implementation.
Profiling globals and GPU timestamp support are injected only into that session.
No production window globals or profiling UI are added.

- `MERCURY_EXTRA_LINES=20000`: append comment lines to the draft.
- `MERCURY_START_ROW=12000`: choose the document-relative caret row before typing.
- `MERCURY_KEY_DELAY=5`: milliseconds between typed characters (default 35).
- `MERCURY_BACKSPACE=1`: delete 30 characters after typing.
- `MERCURY_TRACE=1` / `0`: override the host's tracing choice for this session.
- `MERCURY_DPR=1.25`: emulated pixel ratio (default 1.25).
- `MERCURY_CPU_PROFILE=1`: include sampled CPU hotspots; use a separate run from
  normal CPU timing because sampling adds overhead.
- `MERCURY_GPU_PROFILE=1`: enable timestamp queries when supported; this also adds
  instrumentation, so compare CPU costs using a separate run without it.
- `MERCURY_OUTPUT`: write the complete JSON report to this path.
- `MERCURY_SCREENSHOT`: save a screenshot of the final state to this path.
- `MERCURY_UI_WORKLOAD=1`: also record reload focus/selection, taskbar reordering and
  drag-out, shared-edge resize geometry, and title marquee offsets.

Input-to-submission starts at browser `beforeinput` and ends at GPU queue submit.
It excludes hardware, dispatch before that event, GPU completion, compositor
scheduling, and physical display. The continuous typing workload excludes the
later debounced self-reload.

## What bounds the work

Input requests a coalesced render after the callback. Animation ticks continue
to drive simulation time. Unchanged frames skip GPU submission and presentation.
Viewport source, gutter, selection, and caret remain batched; measurements and
glyph strips reuse bounded caches. The GPU text lookup cache has a 32 MiB budget
and 128-entry ceiling, with one oversized entry permitted. Referenced textures
remain alive independently of cache eviction.

Incremental lexing consumes native edit ranges and reuses unchanged tokens.
Line and span dictionaries materialize only when read. Compact newline offsets
and binary caret lookup avoid constructing or walking every source line per edit.
Large documents use an invisible native editing window, preserving full-document
snapshots and selections. This avoids browser layout of the complete source on
every keystroke without adding editor widgets or language bindings.

Large-document undo currently stores 64 individual edit snapshots and resets
on `sync` or self-reload. Native editing still supplies IME and paste; the proxy
handles global selection, copy/cut, and movement when the window is active.

After the Mercury App core migration, the same traced 20,000-line, row-12,000
typing/deletion workload measured 4.49 ms mean, 6.80 ms p95, and 10.50 ms maximum
input-to-submission latency. It was measured with the regression suite idle.

The editable filesystem/resource/project implementation has not been profiled.
File edits commit changed content plus the metadata index; they do not serialize
all binary assets. Full JSON/base64 snapshots and history archives occur on
explicit project operations. Resource fallback caches successful reads. Recovery
restarts GPU/input services and compiles a fresh editor. These operations are
outside idle-frame painting; their latency still needs browser measurement.
