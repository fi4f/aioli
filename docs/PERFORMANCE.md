# Mayo performance measurements

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
node hg/tools/profile-mayo.cjs
```

The tool starts its own loopback server on a free port and closes it and Chrome
when finished. Set `AIOLI_URL` to use an existing server instead. It loads the
actual editor, disables auto reload for measurement, and runs idle, hover, typing,
and drag workloads. `profile-mayo-typing.cjs` uses the same implementation.
Profiling globals and GPU timestamp support are injected only into that session.
No production window globals or profiling UI are added.

- `MAYO_EXTRA_LINES=20000`: append comment lines to the draft.
- `MAYO_START_ROW=12000`: choose the document-relative caret row before typing.
- `MAYO_KEY_DELAY=5`: milliseconds between typed characters (default 35).
- `MAYO_BACKSPACE=1`: delete 30 characters after typing.
- `MAYO_TRACE=1` / `0`: override the host's tracing choice for this session.
- `MAYO_DPR=1.25`: emulated pixel ratio (default 1.25).
- `MAYO_CPU_PROFILE=1`: include sampled CPU hotspots; use a separate run from
  normal CPU timing because sampling adds overhead.
- `MAYO_GPU_PROFILE=1`: enable timestamp queries when supported; this also adds
  instrumentation, so compare CPU costs using a separate run without it.
- `MAYO_OUTPUT`: write the complete JSON report to this path.
- `MAYO_SCREENSHOT`: save a screenshot of the final state to this path.

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
