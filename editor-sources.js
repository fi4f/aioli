/** Bundled Lisp modules. Paths are project data, so imports stay local and live. */
export const editorSourcePaths = [
  'editor/ui/components.lisp',
  'editor/ui/code-input.lisp',
  'editor/ui/buttons.lisp',
  'editor/ui/sliders.lisp',
  'editor/ui/asset-icon.lisp',
  'editor/ui/menu.lisp',
  'editor/tool-window.lisp',
  'editor/files-pane.lisp',
  'editor/filename-dialog.lisp',
  'editor/file-context-menu.lisp',
  'editor/command-palette.lisp',
  'editor/generator-window.lisp',
  'editor/menu-bar.lisp',
  'editor/about.lisp',
  'editor/ui/tabs.lisp',
  'editor/state.lisp',
  'editor/code-pane.lisp',
  'editor/game-pane.lisp',
  'editor/parameter-pane.lisp',
  'editor/workspace.lisp',
  'editor/asset-preview.lisp',
];

/** Exact prior stock components upgrade on load; customized source stays intact. */
export const editorSourceMigrations = {
  'editor/ui/menu.lisp': [1772708670, -50966153],
  'editor/filename-dialog.lisp': [1154985076, 1646251385, -276640064],
  'editor/code-pane.lisp': [-1223626889, -1468317162],
  'editor/game-pane.lisp': [1363588948, -923398644, 1439413118],
  'editor/parameter-pane.lisp': [1121504706, 1310496164, 6750519, 692954419],
  'editor/ui/sliders.lisp': [-136450857, -142948973],
  'editor/sound-tools.lisp': [-1032021971],
  'editor/graphics-tools.lisp': [1032336507],
  'editor/state.lisp': [
    211691945, 1648129935, 1459810615, -944665620, -1057069312, 691390967, 992134259, 1590589706,
    -2055496859, -1057069312, -1565172755,
  ],
  'editor/menu-bar.lisp': [
    -2009071310, -1055380144, -957744483, -916096429, 304730850, 979661352, 1665781783, 1702792458,
    -916096429, 1702792458,
  ],
  'editor/tool-window.lisp': [259054794, -2051351151],
  'editor/ui/asset-icon.lisp': [
    -1192486599, -280502523, -259385405, 1613894289, -92630030, 1423436376, 808635821,
  ],
  'editor/workspace.lisp': [
    1362729264, -1944554415, 1220562521, 1551145918, -307618452, -411060456, 142027762, -893315815,
    1345042628,
  ],
  'editor/generator-window.lisp': [-1119590777, -706112034, 1411431221, 874538476],
  'editor/ui/buttons.lisp': [1551336297, -484093791, 1977299911, 1662063611, -1716538431],
  'editor/files-pane.lisp': [
    -1242864799, 1910819705, 312300839, -1597373580, 32907249, 13265849, 411241329, -1990252630,
    -1505417256,
  ],
  'editor/file-context-menu.lisp': [80589520, 2125308106, 1127568119],
};
