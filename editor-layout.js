import { resolvePath } from './module-loader.js';
const prefixes = [
  ['ui', 'editor/ui'],
  ['commands', 'examples/commands'],
  ['editor/commands', 'examples/commands'],
  ['generators', 'examples/generators'],
  ['editor/generators', 'examples/generators'],
  ['assets/editor-icons', 'editor/icon'],
];
export function editorLayoutPath(path) {
  for (const [old, next] of prefixes)
    if (path === old || path.startsWith(old + '/')) return next + path.slice(old.length);
  return path;
}
export function legacyEditorPath(path) {
  for (const [old, next] of prefixes)
    if (path.startsWith(next + '/')) return old + path.slice(next.length);
  return path;
}
const pathForKey = (key) =>
  ({
    main: 'main.lisp',
    game: 'game.lisp',
    ui: 'ui.lisp',
    editor: 'editor.lisp',
    scene: 'scene.lisp',
    audio: 'audio.lisp',
  })[key] ?? key;
const relative = (from, to) => {
  const base = from.split('/').slice(0, -1),
    target = to.split('/');
  while (base.length && target.length && base[0] === target[0]) {
    base.shift();
    target.shift();
  }
  const path = [...base.map(() => '..'), ...target].join('/');
  return path.startsWith('..') ? path : './' + path;
};
/** Relocate saved project data without overwriting a destination or customized content. */
export function migrateEditorLayout(sources, resources, state, applicationState) {
  const sourceMoves = new Map(),
    resourceMoves = new Map();
  const occupied = new Set([...Object.keys(sources).map(pathForKey), ...Object.keys(resources)]);
  for (const key of Object.keys(sources)) {
    const next = pathForKey(key) === key ? editorLayoutPath(key) : key;
    if (next !== key && !occupied.has(next)) sourceMoves.set(key, next);
  }
  for (const path of Object.keys(resources)) {
    const next = editorLayoutPath(path);
    if (next !== path && !occupied.has(next)) resourceMoves.set(path, next);
  }
  const moves = new Map([...sourceMoves, ...resourceMoves]);
  const remap = (path) => {
    if (moves.has(path)) return moves.get(path);
    if (occupied.has(path)) return path;
    return editorLayoutPath(path);
  };
  const nextSources = {};
  for (const [key, text] of Object.entries(sources)) {
    const currentKey = sourceMoves.get(key) ?? key,
      previous = pathForKey(key),
      current = pathForKey(currentKey);
    nextSources[currentKey] = text.replace(/;[^\n]*|"(?:\\.|[^"\\])*"/g, (token, offset) => {
      if (token.startsWith(';')) return token;
      let value;
      try {
        value = JSON.parse(token);
      } catch {
        return token;
      }
      if (/\(\s*import\s*$/.test(text.slice(0, offset).replace(/;[^\n]*/g, ''))) {
        let target;
        try {
          target = remap(resolvePath(value, previous));
        } catch {
          return token;
        }
        return JSON.stringify(value.startsWith('/') ? '/' + target : relative(current, target));
      }
      const prefix = value.startsWith('./') ? './' : value.startsWith('/') ? '/' : '';
      const path = prefix ? value.slice(prefix.length) : value;
      const next = remap(path);
      return next === path ? token : JSON.stringify(prefix + next);
    });
  }
  const nextResources = {};
  for (const [path, resource] of Object.entries(resources)) {
    const next = resourceMoves.get(path) ?? path;
    nextResources[next] = resource.source
      ? { ...resource, source: editorLayoutPath(resource.source) }
      : resource;
  }
  const nextState = { ...state };
  for (const key of [
    'tab',
    'tab-last',
    'selected-file',
    'active-generator',
    'image-generator-path',
    'audio-generator-path',
    'text-generator-path',
    'preview-path',
    'hook-path',
    'context-path',
    'folder-source',
  ])
    if (
      typeof nextState[key] === 'string' &&
      !['main', 'game', 'ui', 'scene', 'audio', 'editor'].includes(nextState[key])
    )
      nextState[key] = remap(nextState[key]);
  for (const key of ['open-tabs', 'open-folders', 'project-folders', 'editor-file-paths']) {
    try {
      const paths = JSON.parse(nextState[key]);
      if (Array.isArray(paths))
        nextState[key] = JSON.stringify([
          ...new Set(
            paths.map((path) =>
              typeof path === 'string' &&
              !(
                key === 'open-tabs' &&
                ['main', 'game', 'ui', 'scene', 'audio', 'editor'].includes(path)
              )
                ? remap(path)
                : path,
            ),
          ),
        ]);
    } catch {}
  }
  const nextApplication = Object.fromEntries(
    Object.entries(applicationState).map(([key, value]) => [
      key,
      typeof value === 'string' ? remap(value) : value,
    ]),
  );
  const stockCenter =
    '; Run explicitly from the command palette.\n(set! :x 160)\n(set! :y 190)\n(set! :vy 0)';
  for (const path of [
    'examples/commands/center-player.command.lisp',
    'commands/center-player.command.lisp',
  ])
    if (nextSources[path]?.trim() === stockCenter)
      nextSources[path] = stockCenter.replaceAll('(set! ', '(game-set! ');
  return {
    sources: nextSources,
    resources: nextResources,
    state: nextState,
    applicationState: nextApplication,
  };
}
