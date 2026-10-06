# aioli

Aioli is a small Lisp engine and an editor written as an Aioli application.
The engine interprets Lisp and binds browser input, graphics, audio and resources.
The editor uses those capabilities to manage a second, private application.

```sh
npm install
npm start
```

Open the localhost URL printed by the server in a WebGPU-capable browser.
The app also works below a static hosting subpath, including GitHub Pages.

## Applications and rendering

`main.lisp` starts the editor. `game.lisp` starts the embedded application and the
application exported to HTML. Both use the same module loader, interpreter,
scene staging, lifecycle execution, drawing compositor and audio output.
They have separate definitions, state and file namespaces. Editor-only bindings
allow inspection of game code and state; the game has no access to those bindings.

```lisp
; game.lisp
(start-scene "examples/garden.scene.lisp")
```

Imports resolve relative to their file, or from the application root with `/`.
Dependencies load once. Missing imports and cycles report errors.
Filename extensions have no runtime loading behavior. The editor recognizes
`.scene.lisp`, `.generator.lisp` and `.command.lisp` to offer appropriate controls.

`defdraw render []` is the rendering hook. Ordinary drawables compose shapes,
text and nested GPU effects in painter order:

```lisp
(defdraw plasma [speed] ["Plasma" [2] [320 240]]
  (pixels [p time]
    (rgb (+ 0.5 (* 0.5 (sin (+ (* p.x 0.02) (* time speed)))))
         0.2 0.6)))

(defdraw render []
  (plasma 2)
  (fill "#f8f8f2")
  (text [12 12] "Hello"))
```

Drawing runs once per frame. Pixel bodies compile to GPU material functions;
arguments and state reads become per-invocation uniforms. Changing uniform values
does not recompile the program. Translation, scale, clipping, opacity and blending
apply to the complete composition. Keep ordinary function calls, mutation,
browser operations and audio outside `pixels`.

Optional `init`, `reload` and `update [dt]` hooks manage application lifecycle.
Scenes have private functions and shared application state; `exit` runs before
an incoming scene's `init` and `enter`. Failed evaluation or GPU validation
preserves the working application. Shared helpers use the active caller's
instruction budget and attribute state reads to the active scene.

## State, collections and metadata

State supports bounded JSON-compatible values: finite numbers, strings, booleans,
null, vectors and maps. Collection operations return new values.

```lisp
(init! :player (map :x 160 :y 120) ["Player"])
(set! :player (assoc (get :player) :x 200))
(init! :inventory ["key"] ["Inventory"])
(set! :inventory (conj (get :inventory) "lamp"))

(mapv (fn [x] (* x 2)) [1 2 3])
(reduce (fn [sum x] (+ sum x)) 0 [1 2 3])
```

`lookup`, `keys`, `values`, `contains?`, `slice`, `concat`, `distinct`, `filter`
and `sort` operate on collections. `=` compares collection values structurally.
Collection callbacks share the interpreter's execution budget. Persisted values
are limited to 10,000 nodes and 32 levels of nesting; unsafe property keys,
non-finite numbers, functions and cycles are rejected.

`(definitions)` and `(state-metadata)` return generic declaration records with
source paths, line numbers and uninterpreted annotations. The editor decides
how annotations become inspector controls. It supports numeric sliders,
choices, booleans, colors, text and structured JSON values. Computed defaults
with explicit annotations use their evaluated value without rerunning initialization.

## The editor

File manages sources, folders, assets, projects and exports. Project manages
execution, automatic re-evaluation and canvas size. View manages panes,
preview focus, generators and recovery. Edit provides native text editing;
About opens help and documentation.

- Play buttons run scenes, restart `game.lisp`, or restart the editor from `main.lisp`.
- Files, code and inspector panes collapse independently. Files scroll on both axes.
- F4 focuses the preview and restores the existing pane arrangement.
- Ctrl/Cmd+Enter evaluates. F2 opens the bundled recovery editor. Escape closes tools.
- Inline buttons preview `defdraw` and `defsound` against copied state.
- File operations preserve imported references when dragging files or folders.
- Project → Canvas size sets the pixel buffer resolution; previews and HTML exports enlarge it without smoothing and keep its aspect ratio.
- Editor UI components use automatic rows, columns, flexible space and scroll containers. Files, Code, Game, Scene inspector and Generator inspector panes can dock, float, resize and collapse; layouts persist with projects. Toggle Game through View → Game view. Generators open as floating inspectors, with source editing in Code. See [the component API](docs/ui.html).
- Dock onto another pane's side to create nested splits. Resize floating panes by their edges and docked panes by shared dividers; interacting with floating content brings it to the top.

The editable editor policy lives in `editor/policy/files.lisp` and
`editor/policy/inspector.lisp`: file roles, tabs, dialogs, command filtering,
generator selection, inspector inference, value normalization and hook previews.
New-file starters are ordinary files in `editor/templates/`; example scenes,
commands and generators are ordinary files in `examples/`. They are not JS strings.
`editor/theme.lisp` controls UI colors and dimensions.

Icons in `editor/icon/` are ordinary 64 × 64 black/white PNG assets recolored by
Lisp drawing. Disk-linked images refresh every 1.5 seconds and on focus, bypassing
HTTP caching. Missing icons show `?`. A new project freshly reads bundled assets.

Generators declare `(generator :image "Title")`, `(generator :audio "Title")`
or `(generator :text "Title" "output.txt")`. Image generators use `defdraw render`;
audio generators use `generate-sound`; text generators use `generate-text`.
The `generator` declaration is an editor binding, not an interpreter special form.

## Native boundaries

| Code                                                        | Responsibility                                                           |
| ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| `lisp.js`, `metadata.js`, `state-values.js`                 | Interpretation, bounded collections and generic metadata                 |
| `module-loader.js`, `application.js`, `scenes.js`           | Explicit modules, private applications and shared lifecycle              |
| `drawing.js`, `pixel-block.js`, `shader.js`, `gpu.js`       | Drawing commands, pixel compilation and one GPU compositor               |
| `engine-services.js`, `audio.js`, `audio-output.js`         | Engine capabilities and browser audio                                    |
| `code-input.js`, `source-text.js`, `source-tokens.js`       | Native text input, IME, selection, undo and text layout                  |
| `asset-preview.js`, `resource-icons.js`, `linked-assets.js` | Browser decoding, playback, masks and resource refresh                   |
| `editor-policy.js`                                          | Thin adapter to editable Lisp policy; a Node fallback serves tests/tools |
| `file-tree.js`, `file-moves.js`, `folder-operations.js`     | Cached path indexing and atomic source/file transformations              |
| `app.js`, `standalone.js`                                   | Browser host integration for editor and exported application             |
| `project.js`, `html-export.js`                              | Current project validation and offline packaging                         |

The native file index is cached across repeated pane queries. Drawing bindings
are cached per command list. The interpreter has no knowledge of file panes,
slider annotations or generator discovery. The GPU backend has no legacy scene
or image texture passes. There are no historical project migrations or filename aliases.

## Persistence and export

Current projects use version 1 JSON with `files`, `resources`, `state`,
`applicationState` and `recovery`. Workspace collections are vectors, not JSON strings.
Local storage uses `aioli.project`. Unsupported formats are rejected; prototype
projects from earlier iterations are deliberately not migrated.

File → Export application HTML bundles the runtime, game files and resources into
one offline HTML file. Editor policy and editor source are excluded. Exported
`main.lisp` imports `game.lisp`, initializing fresh game state. PNG export includes
the full shape/text/pixel composition, including row padding for unusual canvas widths.

## Checks and documentation

```sh
npm test
npm run format:check
node tests/browser-pixels.mjs
node tests/browser-pixel-generator.mjs
node tests/browser-scene-inspector.mjs
node tests/browser-folders.mjs
```

Browser checks use Playwright and Chrome; dependencies are discovered from the
configured local runtime. Their screenshots and exports go to ignored `artifacts/`.
The tests cover interpreter limits, metadata, private application state, shared
lifecycle, precise GPU colors/blending, native editing, file operations, asset
refresh and offline exports.

See [the architecture guide](docs/architecture.html), [language reference](docs/language.html),
[engine API](docs/api.html), [editor guide](docs/editor.html) and
[project format](docs/projects.html). Run the server to browse the documentation.
