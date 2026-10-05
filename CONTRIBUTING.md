# Contributing to aioli

The contributor guide lives in [docs/contributing.html](docs/contributing.html) and is available at `/docs/contributing.html` on the running site. Start there for setup, code conventions, a map of the source files, tests, and GitHub Pages publishing.

```sh
npm ci
npm start
npm test
npm run format:check
```

Prefer Lisp changes in `editor/` for complete panes/widgets and `ui/` for reusable controls. The root `editor.lisp` and `ui/components.lisp` import these modules. Register new bundled source paths in `editor-sources.js` as well as adding their Lisp imports. Keep browser services in small JavaScript modules. Comment intent and invariants, use readable names and normal formatting, and document public API changes under `docs/`.
