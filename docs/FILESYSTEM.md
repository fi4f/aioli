# Project filesystem and resources

The active filesystem is ordinary editable Lisp in [editor/vfs.lisp](../editor/vfs.lisp).
Its `FileSystem` namespace owns paths, directory indexes, revisions, file operations,
resource fallback, and editor backup/installation policy. Instances are plain dictionaries.
The Files pane and document workflow remain Lisp in `editor/files.lisp` and `editor/main.lisp`.

## Projects

A project includes both `/editor` and `/project`. `/editor` contains the editor,
filesystem implementation, project serialization hooks, UI library, tools, and icons.
`/project` contains application source and assets. Saving a project includes both
folders. Opening a saved project uses its own editor; repository updates are explicit.
Application export and dependency-based removal of editor files remain future work.

**New project** copies the default editor, examples, and a `/project/main.lisp` entry
into a fresh working project. **Open project** reads a JSON snapshot. **Save project**
downloads `project.json`, including text, binary assets, empty directories, and
explicit saved state. Opening or creating a project archives the previous working
index, contents, and metadata in the underlying storage's `history:<timestamp>` record.
These history records are accessible through `Storage.records`; they have no UI yet.

The portable version-one format is:

```json
{
  "format": "mercury-project",
  "version": 1,
  "editor": "/editor/main.lisp",
  "entry": "/project/main.lisp",
  "assetURL": "https://example.com/assets/",
  "directories": ["/", "/editor", "/project"],
  "files": {
    "/editor/main.lisp": {
      "encoding": "utf8", "data": "...", "mime": "text/plain", "text": true
    },
    "/project/main.lisp": {
      "encoding": "utf8", "data": "...", "mime": "text/plain", "text": true
    }
  },
  "state": { "editor": {}, "project": {} }
}
```

Binary contents use `encoding: "base64"`. JSON decoding stays native: type tags
are not automatically restored. Paths must be canonical, absolute, case-sensitive
Unicode strings under `/editor` or `/project`, and all parents must exist. The
editor and application entry files must exist. Unsupported formats, malformed file
data, duplicate directory/file paths, and missing parents are rejected before replacing
the working filesystem. The previous working project is archived in the same atomic commit.
No older portable JSON schema is inferred; the browser VFS migration described below
is separate from portable snapshot import.

### State capture and refresh checkpoints

[editor/project.lisp](../editor/project.lisp) exports `Project.capture`, `restore`,
`snapshot`, `open`, `create`, `saveState`, `newSession`, `checkpoint`, `sessionState`, and
`resetEditor`. They are ordinary Lisp functions
that projects can change. The default schema saves the Source file path, selection,
scroll, auto-reload setting, Files tree selection/expansion, docking layout, plain
tool settings in `app.state.tools` (including binding expansion and pages), image preview path/pan/zoom, and plain application
data in `app.state.project`. Unsaved drafts are included when available.
Promises, component nodes, input proxies, GPU handles, and namespace functions are
excluded from the default schema. Unsupported values in the explicitly selected
state cause JSON serialization to fail. The default restore hook reconstructs
docking rectangles explicitly; it does not introduce global tagged-value decoding.

File edits autosave after 400 ms, excluding IME composition. Text-file switching
finishes saves first. File revisions prevent overwriting a changed file; a failed
save keeps the draft. The host checkpoints selected state every 500 ms and
synchronously on page hide or when the tab becomes hidden. Per-tab session storage
preserves the final draft, selection, scroll offsets, pane rectangles, docking
tree/order, minimized/closed flags, preview settings, and selected application data
across refresh without waiting for IndexedDB writes during unload. GPU resources
are recreated from source; image previews reload their texture explicitly.

Checkpoint identity includes the project replacement generation, root metadata,
entry, and asset URL. Replacing a project invalidates its old checkpoint; ordinary
file writes retain it. Unreadable checkpoints, incompatible formats, and checkpoints
for another project fall back to the saved project state. Failed runtimes use the
trusted capture schema during host cleanup.
Portable snapshots and durable project-state records remain explicit saves;
automatic refresh checkpoints belong to the current browser tab.
Images open in a separate floating pane, preserving the Source buffer. Drag to pan,
wheel to zoom, Fit to enlarge/shrink, and 1:1 for one image pixel per bitmap pixel.
Sampling is nearest-pixel and the background is a checkerboard.

## Resource adapter

`FileSystem.fetch(filesystem, url, options)` resolves virtual resources internally
first. An existing file returns its content record. A missing file is fetched relative
to the project's configured `assetURL`; successful fallback results are stored internally
so subsequent reads and project saves include them. An intervening internal write wins
over a fetched result. Existing directories, storage failures, and decode errors propagate.
Explicit external URLs use native fetch and remain external dependencies.

**Assets > Asset base URL** configures the HTTP/HTTPS fallback directory; press Enter
to apply it. It is preserved in project metadata and snapshots. Relative imports and
images resolve against the defining program's source URL. Unicode, spaces, `#`, and
other filename characters are URL-encoded. Fetches bypass HTTP caching.

`(fetch url)` is the native-fetch wrapper. `(resource reference)` calls the owning
app's Lisp adapter. Both return a promise for a plain resource record containing
`status`, `ok`, `mime`, `encoding`, `data`, and `size`; network records also contain
URL and response headers. `Resources.text` and `Resources.bytes` decode records.
Core module and image loaders use the same per-app adapter via `App.setFilesystem`.

## Lisp filesystem forms

Forms capture their compiled program's owning app. `App.setFilesystem(app, state,
namespace)` connects a Lisp filesystem operation namespace to an app. `Vfs` inside
the editor refers to that namespace; `app.filesystem` refers to its plain state.

| Form | Result |
| --- | --- |
| `(fs-list directory)` | Immediate metadata list; directories first; default `/` |
| `(fs-stat path)` | Immediate metadata copy or nil |
| `(fs-read-text path)` | Promise for a stored text file |
| `(fs-read-bytes path)` | Promise for a native list of bytes |
| `(fs-write-text path contents [revision])` | Promise for committed metadata |
| `(fs-write-bytes path bytes [mime [revision]])` | Promise for committed binary metadata |
| `(fs-mkdir path)` | Promise; create a directory |
| `(fs-move from to)` | Promise; move a subtree without replacing a destination |
| `(fs-remove path)` | Promise; remove file or empty directory |
| `(fs-remove-tree path)` | Promise; remove subtree |
| `(fs-refresh)` | Promise; refresh cached records and metadata |
| `(fs-url path)` | Encoded virtual resource URL |
| `(fs-join directory name)` | Path for a single name |
| `(fs-parent path)` / `(fs-name path)` | Parent / basename |
| `(fs-contains directory path)` | Descendant or same path |
| `(fs-rebase path from to)` | Path after moving an ancestor |

Paths normalize `.` and `..` without escaping root; names reject separators and
control characters. Dictionary keys stay strings. Metadata contains `path`, `name`,
`kind`, `revision`, `size`, and `modified`; files add `mime`, `text`, and `image`.
Omitted write revisions mean unconditional writes; zero requires absence. Root cannot
be moved or removed. `.lisp` files use the code icon, including uppercase extensions.

## Native mechanisms

- [hg/storage.js](../hg/storage.js): `Storage.new`, `records`, `commit`, and `close`.
  Generic IndexedDB key/value records with atomic batches and expected-version checks.
  Operations are `{ kind: "put", key, value }` or `{ kind: "remove", key }`.
  `Storage.readSession(store, key)`, `writeSession(store, key, string)`, and
  `removeSession(store, key)` synchronously access per-tab string checkpoints,
  namespaced by the store name. JSON encoding and checkpoint policy stay in Lisp.
  It has no paths, directories, bundle update rules, or project serialization policy.
- [hg/resources.js](../hg/resources.js): native fetch, response decoding, text/byte
  resource construction, URL operations, file selection, and downloads.
- [hg/strings.js](../hg/strings.js): plain string operations used by editable Lisp.
- `remove-key` removes a string key from a plain dictionary, returning the same dictionary.

The default working store is `hg-storage:mercury-project`. `index` holds plain metadata,
`file:<path>` holds each content record, and `project` holds project settings/saved state.
Each file edit writes that file and its index, rather than serializing all binary assets.
The separate `defaults` record stores pristine recovery resources. A host owns and closes
storage; disposing an app does not delete the working project. Cross-tab changes require
refresh; stale commits reject. Storage remains scoped to browser origin, including port.

## F2 recovery

The host registers **F2** before project Lisp executes, including native text-input
focus. Recovery abandons the failed app without running its detach hook, creates a
fresh app, and uses the independent default filesystem/project code and default editor
resources. Current project files are preserved on entry. Default resources are cached
separately from project files so project overrides cannot alter the recovery bundle.
Startup refreshes this pristine bundle from the repository before loading recovery
modules, falling back to its cached contents when fetching fails. Refreshing the
recovery bundle does not update the packaged editor in an existing project.

- **Resume project editor** saves repairs and rebuilds the packaged editor and its
  adapter. A failed startup returns to recovery.
- **Restore default editor** saves the draft, archives customized editor files under
  `/editor/backups/<timestamp>/`, and installs default editor files in an atomic commit.
  Existing backups and `/project` files remain intact. It then resumes the project editor.

`index.html?recovery=1` boots recovery directly. The older `?editor=repository` URL
remains an alias. A main-thread infinite loop prevents key handling; reload using the
recovery URL in that case. The host supplies recovery/default-file bindings; menus,
filesystem mutation, backups, and project-save policy remain editable Lisp.

## Existing browser files and default assets

On first launch of the new store, a read-only host importer reads the previous `hg-vfs:mercury` database
without deleting it. `Project.migrate` moves the editable UI library to `/editor/ui.lisp`,
old `/editor-backups` into `/editor/backups`, and other legacy root files under
`/project/legacy`. Missing default editor modules are supplied. Existing editor sources
are preserved; F2 can repair them or explicitly restore the new default editor.
Migration and new project creation both use `Project.create`, which validates a
complete snapshot and replaces the working project in one atomic transaction.
An absent legacy database is not created; existing legacy records are never changed.
The adapter supports the former `/hg/ui.lisp` import as an alias.

Filesystem behavior has one implementation, `editor/vfs.lisp`. The former `hg.Vfs`
API and `App.new({ filesystem })` option are removed. Attach an already constructed
filesystem with `App.setFilesystem(app, state, namespace)`. Construction is awaited
directly; the redundant `fs-ready` form is removed. Project creation belongs to
`Project.create`; the separate bootstrap module and unused `Project.defaults` are removed.
Regenerate the default manifest when adding files:

```sh
node hg/tools/generate-vfs-seed.mjs
```

Application export, tree shaking, project execution, history UI, and local folder
mounts remain later work.
