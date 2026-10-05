# aioli

**a**ll **i**n **o**ne **li**sp.

A fullscreen aioli editor running in the browser. The editor is an application written in Lisp, drawing its own interface with pixel primitives. Its game view is another pixel program rendered into a texture and composited into the editor.

## Run

Requires Node.js 20+ and a browser/device with WebGPU support.

```sh
npm start
```

Open **http://localhost:4173**. The app has no browser dependencies or external font requests. The server binds to loopback. Other deployments require HTTPS for WebGPU. For contributing, run `npm ci` to install the pinned development formatter.

## Documentation

Open [the documentation site](http://localhost:4173/docs/) locally, or use **About → Documentation** in a fresh/default editor. The same static pages ship under `docs/` on GitHub Pages:

- [Language](docs/language.html): syntax, functions, shared state, and the shader subset.
- [API reference](docs/api.html): drawing, input, widgets, audio, and editor actions.
- [Projects and tools](docs/projects.html): file explorer, imports, mixed scenes, generator windows and Lisp commands.
- [Editor guide](docs/editor.html): live editing, procedural tools, projects, and recovery.
- [Contributing and hosting](docs/contributing.html): code conventions, tests, and GitHub Pages setup.

Publish the repository's **root** on GitHub Pages so both the app and `/docs/` are included. Keep `.nojekyll` at that root. Relative assets and module-relative Lisp/doc URLs support project sites such as `https://USER.github.io/REPOSITORY/`; the docs are then at `REPOSITORY/docs/`. Publishing only the `/docs` folder would omit the app.

## The editor is the app

- `main.lisp` imports the fullscreen workspace from `editor/`, where each pane, menu and widget has its own file.
- `editor/ui/components.lisp` imports reusable controls from `editor/ui/`: buttons, sliders, tabs, menus, asset icons and source painting.
- The visible browser surface is one WebGPU canvas. HTML and CSS do not style or lay out editor controls.
- `fill`, `rect`, `circle`, `line`, `text`, `translate`, `scale`, `opacity`, `blend`, and `scope` produce ordered pixel drawing operations. `clip` restricts coverage. `surface` samples the running game.
- Buttons and sliders read pointer input and update shared state in Lisp. Widget implementations can be redefined live. `region` declares their input/accessibility bounds without creating a visible native control.
- The source editor gets text/selection data from a browser input service and draws it using Lisp `fill`, `rect`, and `text` calls. A hidden textarea supplies keyboard, clipboard, selection, and IME input. Hidden semantic controls provide keyboard and screen-reader access to Lisp regions; they never paint the UI.

The menu bar contains **File, Project, View, Edit, About**. File manages sources/projects and exports; Project runs the game; View opens panes, generators and recovery; Edit provides undo/redo and clipboard actions; About contains help and documentation. Small viewports switch between code and game instead of squeezing both into columns.

## Try it

1. Click the game. Move with A/D or Left/Right and jump with Space, Up, or W.
2. Open **View → Scene inspector** to inspect and edit live application/scene state. Labels, numeric limits, steps, choices and other control types use the same `init!` annotations as generators. Scroll with the mouse wheel or drag the scrollbar; arrows indicate more fields above or below.
3. Edit `game.lisp` to choose a scene with `start-scene`. Open `examples/garden.scene.lisp` for its CPU `update`, procedural `sound`, and WebGPU `defpixel render` hooks.
4. Open `editor/workspace.lisp` or a pane file to change layout; open `editor/state.lisp` to change theme defaults. Each imported component can be edited live.
5. Edit `editor/ui/` components to change how buttons or sliders look and behave, or customize the source widget's syntax colors.

Valid edits evaluate after a short typing pause or **Ctrl/Cmd+Enter**. `init!` initializes missing state without resetting the running world. Rejected edits keep the previous runtime and GPU pipeline. Local storage keeps accepted source and state; invalid drafts remain in the current source view and can be included in an exported project.

**F2** opens the stock recovery editor if a live edit hides the controls or breaks the editor frame. Your draft remains available, and Ctrl/Cmd+Enter applies repairs. Startup also opens a recovery shell if a saved project cannot evaluate. File operations keep recovery active. **Use latest editor** adopts the bundled editor with backups of custom sources; **View → Project editor** exits recovery explicitly. Escape closes menus/tools. Wheel scrolls source vertically; Shift+wheel scrolls horizontally.

Projects export/import as JSON with separate editor and application state. **File → Export application HTML** downloads one HTML file containing the runtime, every game module, and all assets. A generated `main.lisp` imports `game.lisp`; startup uses fresh game state and excludes the editor package. The file runs offline in a browser with WebGPU support. Game images export as PNG. The sound tool synthesizes swept oscillators or seeded noise, mixes an optional overtone, and exports PCM WAV. Each voice has attack/release and the mix uses soft clipping.

Play `examples/doom.scene.lisp` for **Tiny Crypt**, an asset-free first-person raycaster written entirely in Lisp. Click its play button in Files, then click the preview (F4 enlarges it). W/S or Up/Down walk, A/D strafe, Left/Right or Q/E turn, Space fires, and R restarts. Defeat the three monsters (two hits each), then reach the green gate in the southeast corner. Its movement settings are editable in the inspector; pistol/minimap drawing and procedural sounds expose hook previews. Existing projects receive this example once without replacing a customized copy.

A new project has just `editor/` and `examples/` alongside `main.lisp` and `game.lisp`.
`editor/theme.lisp` centralizes the editor palette and shared layout metrics. The default is a charcoal Monokai-inspired theme with cyan accents and pink/purple/yellow syntax. Edit its `set!` declarations and evaluate to update colors and spacing immediately, including in saved projects. See [theme customization](docs/editor.html#theme) for the constants and supported dimensions. Gameplay artwork stays independent.

Editor controls and PNG icons live in `editor/ui/` and `editor/icon/`. Sample commands and generators live in `examples/commands/` and `examples/generators/`. Existing saves migrate these paths and references.

## Project files and commands

**View → Files pane** toggles a docked project pane beside code. Click its header chevron to collapse it to a narrow rail; click again to restore it. Collapsing preserves selection, folder expansion, and scroll position. Its folder tree expands/collapses, preserves expansion, and opens files without closing the pane. Use File or the tree's right-click menu to create, import, download, rename or delete files. New/Rename opens a filename dialog. Icons distinguish code, images and audio; scroll vertically with the wheel/scrollbar, or horizontally with Shift+wheel, a trackpad gesture or the bottom scrollbar. Click source files to open persistent, closable tabs. Click image/audio assets for pan/zoom image previews or waveform playback and seeking. Create additional modules, open them in the code pane, and import them with a project-local path:

```lisp
(import "./lib/movement.lisp")
```

Imports resolve relative to the importing file; leading `/` means that application's root. Dependencies load once, and cycles/missing files report errors. `main.lisp` launches the editor and `game.lisp` launches the embedded application. Each has private modules, definitions, state, input and lifecycle hooks. Commands use `get`/`set!` for editor state and `game-get`/`game-set!` for game state, and can use both in the same command. The editor can inspect game source and state through `game-code`, `game-state`, `game-get`, `game-set!`, `game-definitions` and `game-call`; those capabilities are absent from the game. `.command.lisp`, `.generator.lisp` and `.scene.lisp` are editor conventions only. The runtime loads explicit module paths regardless of suffix. Define `update [dt]` for CPU updates, `draw []` for CPU drawing, and `defpixel render [p time]` for a pixel shader. Optional `init` and `reload` hooks run on activation/reset and live edits respectively. `(start-scene "examples/bloom.scene.lisp")` stages a scene transition while preserving the editor. The file tree uses a controller for `game.lisp`, gears for generators, and movie clappers for scenes. Play a scene to switch the preview; play `game.lisp` to restart the embedded application. The editable `examples/` gallery replaces the demo-cycle action. Legacy saves migrate old entries and preserve custom editor code in `main.lisp`.

**View → Generator inspector** discovers `.generator.lisp` files anywhere in the project. Declare `(generator :image "Title")` with a `defpixel image` hook, or `(generator :audio "Title")` with `generate-sound`. Text generators declare `(generator :text "Title" "levels/generated.csv")` and return a string from `generate-text`. Literal `init!` values supply inspector fields; optional annotations describe controls:

```lisp
(init! :radius 48 ["Radius" 1 120 1])
(init! :wave "sine" ["Wave" ["sine" "triangle"]])
```

Numbers use sliders; booleans use toggles; choices cycle through values; colors open a picker; strings offer an editable value. Image, audio and scrollable text previews stay separate from gameplay. Text output regenerates when inspector fields change; Generate forces another run. Its filename defaults to `generated.txt`, and Keep/Download preserve exact UTF-8 text as an ordinary resource. **Keep** adds the output to project resources; **Export** also downloads it. Generators can import helpers.

**View → Command palette** or **Ctrl/Cmd+Shift+P** opens the palette. Search `.command.lisp` programs in any folder, or type Lisp and press Ctrl/Cmd+Enter. Programs run in the editor environment and can inspect or change game state through `game-*` APIs, and automate exports. Commands execute on request, never on each frame or while typing.

Projects save as version 21 JSON containing named `files`, binary `resources`, editor `state`, and `applicationState`. Legacy saves migrate. Read [the project guide](docs/projects.html) for the exact resolution rules, limits and APIs.

## Architecture

| File                 | Responsibility                                                  |
| -------------------- | --------------------------------------------------------------- |
| `editor/`            | Fullscreen workspace, panes and complete widgets                |
| `editor/ui/`         | Reusable immediate-mode controls and source painting            |
| `lisp.js`            | Reader, functions, shared state, bounded CPU interpreter        |
| `shader.js`          | Lisp-to-WGSL scene compiler and shared pixel coverage functions |
| `drawing.js`         | Drawing state, primitive command stream, clipping, spatial bins |
| `gpu.js`             | WebGPU host: scene pass and fullscreen editor pass              |
| `editor-sources.js`  | Static manifest of bundled live Lisp modules                    |
| `code-tabs.js`       | Persistent open buffers and tab overflow data                   |
| `asset-preview.js`   | Browser asset decoding and audio preview transport              |
| `code-input.js`      | Hidden native input and source/selection/token data             |
| `source-tokens.js`   | Lossless display scanning, including incomplete strings         |
| `audio.js`           | Procedural audio mixing and WAV encoding                        |
| `app.js`             | Native bindings, live evaluation, persistence, recovery         |
| `project.js`         | Workspace serialization and legacy migration                    |
| `module-loader.js`   | Runtime module resolution without filename conventions          |
| `application.js`     | Common application entry launcher and lifecycle hooks           |
| `engine-services.js` | Browser/graphics/audio capabilities without editor access       |
| `html-export.js`     | Self-contained HTML packaging                                   |
| `standalone.js`      | Offline browser application host                                |
| `generators.js`      | Stock image/audio/text recipes and saved command sources        |
| `examples.js`        | Starter scene, gameplay, and sound programs                     |

The CPU editor program runs every frame and emits a drawing stream. WebGPU evaluates that stream per pixel over a fullscreen quad. Spatial bins restrict each pixel to nearby commands while preserving painter order. Rectangles, circles, and lines share coverage semantics with compiled scene shaders; text samples a glyph atlas and the game view samples the scene texture. No per-widget or per-shape geometry is submitted.

Only a scene’s pixel hook compiles to WGSL. Separate render passes draw the game and generated image into 320 × 240 textures, then composite them alongside editor primitives into the fullscreen surface. The browser host/interpreter/compiler remain JavaScript. The editor application and widget painting/interaction are Lisp, rather than Lisp descriptions of an HTML dashboard. See the [WebGPU specification](https://gpuweb.github.io/gpuweb/) and [WGSL specification](https://gpuweb.github.io/gpuweb/wgsl/) for the underlying APIs.

## Checks

```sh
npm test
```

Tests cover the reader, gameplay, state-preserving hot reload, procedural audio/WAV, shader emission, fullscreen Lisp drawing, widget replacement, clipping/bin order, incomplete-string display, documentation links/examples, and project subpaths.

`npm run format` applies the repository's formatting conventions; `npm run format:check` verifies them. See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidance.

With the server running, `node tests/browser-smoke.mjs` runs headless Chromium integration checks. It requires Playwright and a browser executable; override `PLAYWRIGHT_MODULE` and `BROWSER_EXECUTABLE` for other local installations. It checks actual WebGPU rendering and compilation, verifies that only the canvas paints, edits the Lisp editor/library through keyboard input, verifies quote painting, drags a pixel slider, recovers an editor with no controls, exercises gameplay and all presets, imports/exports projects, exports WAV/PNG, and checks local persistence, documentation navigation, narrow layouts, and a simulated GitHub Pages project path. Screenshots are written to `artifacts/`. `node tests/browser-scene-inspector.mjs` verifies scene/game playback, restart isolation, annotated field edits, rollback and narrow layouts. `node tests/browser-application.mjs` checks one-way inspection, isolated state, CPU drawing, native HTML export, offline startup and dynamic scenes. `node tests/browser-widgets.mjs` starts its own server below a repository subpath and tests named-file creation, imports, mixed scenes, saved/typed commands, independent generator previews and exports, v5 resource persistence and narrow tool windows.

## Current scope

The Lisp runtime and shader subset are deliberately small. CPU functions cannot yet be called from shaders. There is no persistent GPU feedback, arbitrary graph routing, sprite painting, multiplayer. Procedural tools manipulate recipes through sliders and code; they are not yet full node graph editors. Rendering follows device pixel density, including fractional OS scaling. Font rasterization, text/input data services, file access, audio, and GPU bindings are native host services.

Exported HTML preserves the logical 320 × 240 game canvas with centered letterboxing. Window resizing scales shader and CPU drawing uniformly; pointer coordinates and `screen-width`/`screen-height` stay in game coordinates.

The editor preview fills its available pane while keeping a 4:3 aspect ratio. Click **Focus / F4**, use **View → Focus preview**, or press **F4** to hide the other panes. Toggle again (or press Escape) to restore the previous panes, tabs, and inspector position.

The Files pane, code editor, and scene inspector each have a header chevron that folds the pane into a narrow rail. Click it again to restore the pane. Collapsing preserves source drafts, active tabs, folder expansion, and scroll positions, and gives the recovered space to the preview. View still controls whether each pane is shown.

Editor icons are ordinary imported images in `editor/icon/`, listed under Files. Image data is saved in project JSON and bundled into exported HTML with other resources. Lisp widgets select image paths for tinting; replacing, renaming or deleting an icon uses the same asset operations as any other image.

File → **New project** starts a fresh default project using `examples/garden.scene.lisp`, reloads default assets from disk, and clears files, assets and state from the previous project. **Open file** imports an individual source or asset; **Save file** downloads the current source draft or asset. Project open/save remain separate. Drag a file onto a folder in Files to move it, or onto the Project files header to move it to the root. Moves preserve tabs and update literal paths and relative imports. Existing destinations are never overwritten, and entry files keep their root names.

Right-click in Files to create folders, including empty ones. Folder menus offer recursive rename, move and delete; folders can also be dragged. Moves preserve tabs and rewrite imports and literal references. Folder deletion is rejected if it breaks required imports or the active scene. These actions affect saved project data, not disk directories.

Project → **Automatic re-evaluation** is enabled by default. Disable it to execute edits only on request with Ctrl+Enter or the `main.lisp` run button. The preference persists; disabling cancels queued evaluation and enabling applies pending edits.

Images imported from bundled project files retain a source link. The editor checks linked assets for disk changes every 1.5 seconds and on focus, bypassing HTTP caching. Bytes in project JSON and HTML exports are refreshed too. Missing file icons display `?`; ordinary imported images without a source link retain their saved bytes.

Use `defdraw` and `defsound` for composable, inspectable CPU hooks:

```lisp
(defdraw badge [x y] ["Badge" [160 120] [320 240]]
  (scope (fill "#bbd6a6") (circle [x y] 20)))
(defsound jump [pitch] ["Jump" [300]]
  (voice :sine pitch (* pitch 3) 0.15 0.3))
; Inside draw: (badge 160 120)
; Inside gameplay: (play-sound :jump 300)
```

A **Preview draw** or **Preview sound** button appears directly above each top-level declaration in the code editor. These extra UI rows are not part of the source and do not change line numbers, copying, or saved files. Clicking one previews that hook with copied state; **Code** returns to the same source buffer. Drawing hooks get a fresh canvas; sound hooks get a waveform with playback and seeking. Preview arguments are editable. Named sounds capture their recipe before asynchronous playback, so multiple effects can overlap without a shared selector.
