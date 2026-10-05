/** Bundled Lisp modules. Paths are project data, so imports stay local and live. */
export const editorSourcePaths = [
  'ui/components.lisp',
  'ui/code-input.lisp',
  'ui/buttons.lisp',
  'ui/sliders.lisp',
  'ui/asset-icon.lisp',
  'ui/menu.lisp',
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
  'editor/code-pane.lisp': [-1468317162],
  'editor/game-pane.lisp': [1363588948, -923398644, 1439413118],
  'editor/parameter-pane.lisp': [1121504706, 1310496164, 6750519, 692954419],
  'ui/sliders.lisp': [-136450857, -142948973],
  'editor/sound-tools.lisp': [-1032021971],
  'editor/graphics-tools.lisp': [1032336507],
  'editor/state.lisp': [
    1648129935, 1459810615, -944665620, -1057069312, 691390967, 992134259, 1590589706, -2055496859,
    -1057069312,
  ],
  'editor/menu-bar.lisp': [
    -1055380144, -957744483, -916096429, 304730850, 979661352, 1665781783, 1702792458, -916096429,
    1702792458,
  ],
  'editor/tool-window.lisp': [-2051351151],
  'ui/asset-icon.lisp': [
    -1192486599, -280502523, -259385405, 1613894289, -92630030, 1423436376, 808635821,
  ],
  'editor/workspace.lisp': [
    -1944554415, 1220562521, 1551145918, -307618452, -411060456, 142027762, -893315815,
  ],
  'editor/generator-window.lisp': [-1119590777, -706112034, 1411431221],
  'ui/buttons.lisp': [1551336297, -484093791, 1977299911, 1662063611, -1716538431],
  'editor/files-pane.lisp': [
    1910819705, 312300839, -1597373580, 32907249, 13265849, 411241329, -1990252630,
  ],
  'editor/file-context-menu.lisp': [2125308106, 1127568119],
};
