# Contributing to aioli

The contributor guide lives in [docs/contributing.html](docs/contributing.html) and is available at `/docs/contributing.html` on the running site. Start there for setup, code conventions, a map of the source files, tests, and GitHub Pages publishing.

```sh
npm ci
npm start
npm test
npm run format:check
```

Prefer Lisp changes in `editor/` for complete panes/widgets and `editor/ui/` for reusable controls. The root `main.lisp` and `editor/ui/components.lisp` import these modules. Register new bundled source paths in `editor-sources.js` as well as adding their Lisp imports. Keep browser services in small JavaScript modules. Comment intent and invariants, use readable names and normal formatting, and document public API changes under `docs/`.

Keep editor policy in `editor/policy/` and templates/examples in Lisp files.
Keep the interpreter independent of editor roles, annotation interpretation and project formats.
Keep browser input, codecs, native drawing/audio, cached indexing and source rewriting native.
Keep file/inspector/settings workflows, shortcut decisions and docking rules in Lisp policy.
Policy functions return data/patches; native adapters perform browser effects and atomic commits.
Component measurement remains native; use tests/benchmark-editor-policy.mjs before expanding
interpreted frame work. Persistent collections and runtime definition versions keep caches valid.
Keep F2 and bundled recovery dispatch native so broken policy can always be repaired.
Editor and exported applications must use the same application lifecycle implementation.
Prefer deleting unused prototype compatibility paths over adding migrations. Project format
version 1 accepts structured JSON state; workspace tabs/folders are vectors. Use the tests
for current behavior rather than retaining obsolete migration fixtures.
