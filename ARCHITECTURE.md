# Aioli application architecture

The host creates an Aioli runtime, attaches a canvas, and loads a Lisp entry
point. The editor is an application using that same runtime implementation.
The compiler remains JavaScript; self-hosting the editor does not require
self-hosting the compiler.

## Code boundaries

- `aioli.js`: stable public JavaScript entry point.
- `engine/compiler/`: reading and compilation to JavaScript and WGSL.
- `engine/language/`: values, standard bindings, types, math, text builders,
  and execution helpers. These modules do not own browser UI.
- `engine/runtime/`: application orchestration, scene scheduling, module
  loading, and shared execution contracts.
  `Stage` in `stage.js` hosts a scene and performs its lifecycle, updates, and
  rendering; each Aioli instance owns its stage as `runtime.stage`.
- `engine/browser/`: canvas presentation, GPU resources, text rasterization,
  and browser input adaptation.
  The canvas adapter observes the outer canvas's bounding rectangle and manages
  both bitmap dimensions and resize notification. Hosts only provide layout.
- `hosts/`: browser boot code. `editor.js` loads the Lisp editor;
  `playground.js` owns the existing development controls.
- `editor/`: Lisp editor application and its future libraries.
- `examples/`: standalone Lisp applications and language examples.

The compiler consumes input callback names and configuration binding metadata
from `engine/runtime/contracts.js`, rather than importing browser adapters.
The runtime composes the compiler and adapters. Language bindings stay separate
from host boot logic and editor policy.

## Entry points

Serve the repository over localhost, then open `/editor.html` to boot
`editor/main.lisp`. That script renders its own source editor on the GPU canvas
and debounces edits for 400 ms before requesting self-replacement. `text-proxy`
provides invisible native input services. Source, selection, and scroll position
live in Lisp state shared across reloads. Changes stay in memory.
`/index.html` retains the development playground
and generated JavaScript/WGSL inspection.

Lisp modules resolve relative to the file that imports them. Keeping the editor
entry point's source URL allows editor libraries to use ordinary relative imports.
The two runtime bindings used by Mayo are `text-proxy` and `aioli`; operations
live on their handles rather than becoming individual top-level bindings.

## Follow-on work

Application handles and preview surfaces require an API design discussion.
Today, one Aioli instance owns one canvas, one active scene, and one module cache.
The editor must not run previews by replacing its own scene. Independent runtime
instances already separate scene and module state, but embedded rendering and
Lisp control of those instances are not implemented.

Precise caret measurements and the `(text)` API remain a joint design discussion.
The MVP uses existing text snapshots to estimate monospace cell width; it does
not implement bidirectional layout or accurate variable-width caret geometry.
Native input supports composition, while syntax errors return formatted Lisp
traces. Imported modules retain their caches, edits are not saved to disk, and
self-reload does not roll back initialization effects. Traced self-reloads check
candidate attachment and first rendering and restore the working scene on
synchronous failure. Later-frame and asynchronous GPU failures still require
broader containment. Untraced runtimes retain ordinary failure behavior.
Project file access needs a later contract. Widget layout,
document models, commands, undo, inspectors, and reload policy belong in Lisp.
This directory structure leaves places for those capabilities without inventing
their bindings ahead of that discussion.
