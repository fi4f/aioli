# Editor icon artwork

Delivery format: one 64 × 64 PNG per icon. Use black artwork on a white or transparent background. White backgrounds and white holes will be converted to transparency; black artwork will be recolored from the editor theme. Grayscale antialiasing is fine.

Keep roughly 5 pixels of padding on every side. Use simple silhouettes or consistent strokes about 5 pixels thick. Avoid tiny details, gradients, and lettering. File icons will display at approximately 16 CSS pixels and button icons at 20 CSS pixels; inspect the art at these sizes. 64 × 64 provides enough source detail for these sizes on high DPI displays.

Provide these 11 initial files in `editor/icon/`:

- `game.png` — controller, for game.lisp
- `main.png` — editor/window, for main.lisp
- `scene.png` — movie clapper
- `generator.png` — gear or steam engine
- `command.png` — executable command
- `folder.png` — folder
- `code.png` — ordinary source file
- `image.png` — image resource
- `audio.png` — audio resource
- `file.png` — other resource
- `play.png` — play/restart action

Optional UI artwork: `chevron-up.png`, `chevron-down.png`, `chevron-left.png`, `chevron-right.png`, and `close.png`.

Icons are ordinary project image resources in `editor/icon/`, visible in the Files pane. You can preview, download, rename, delete or replace them like other imported images. JSON saves retain the actual image data; exported HTML bundles these resources like every other project asset.

Bundled artwork seeds fresh projects and migrates older saves once. Subsequent saves preserve replacements and deletions. Lisp widgets choose resource paths; the renderer decodes those resources into theme-tinted masks and rebuilds the atlas for the current display density. Missing or invalid file icons show a question mark. All 11 initial icons are supplied.

The Lisp editor uses `(icon-available? "editor/icon/code.png")` and `(icon "editor/icon/code.png" [x y] [16 16])`. These operations accept any image resource path; paths and theme colors are chosen by Lisp, rather than being hardcoded into the renderer.

Disk-backed assets have a `source` path in their resource record. The editor refreshes these links every 1.5 seconds and on focus with HTTP caching disabled, updating both the UI and saved data. Replaced resources without a source link remain ordinary embedded assets. Older bundled icon copies migrate to disk links once.
