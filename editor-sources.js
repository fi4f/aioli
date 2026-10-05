/** Bundled Lisp modules. Paths are project data, so imports stay local and live. */
export const editorSourcePaths = [
  'ui/components.lisp',
  'ui/code-input.lisp',
  'ui/buttons.lisp',
  'ui/sliders.lisp',
  'ui/asset-icon.lisp',
  'ui/menu.lisp',
  'editor/graphics-tools.lisp',
  'editor/sound-tools.lisp',
  'editor/tool-window.lisp',
  'editor/files-pane.lisp',
  'editor/filename-dialog.lisp',
  'editor/file-context-menu.lisp',
  'editor/command-palette.lisp',
  'editor/generator-window.lisp',
  'editor/menu-bar.lisp',
  'editor/about.lisp',
  'ui/tabs.lisp',
  'editor/state.lisp',
  'editor/code-pane.lisp',
  'editor/game-pane.lisp',
  'editor/parameter-pane.lisp',
  'editor/workspace.lisp',
  'editor/asset-preview.lisp',
];

/** Exact prior stock components upgrade on load; customized source stays intact. */
export const editorSourceMigrations = {
  'ui/asset-icon.lisp': [808635821],
  'editor/workspace.lisp': [-893315815],
  'editor/generator-window.lisp': [1411431221],
  'ui/buttons.lisp': [-1716538431],
  'editor/files-pane.lisp': [-1990252630],
  'editor/file-context-menu.lisp': [1127568119],
};
