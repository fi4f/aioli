import { generatorSources } from './generators.js';
import { editorSourcePaths } from './editor-sources.js';
import { sourcePath } from './project.js';
import { resolveModules } from './module-loader.js';

/** A workspace presents both applications; each launcher receives its own store. */
export function applicationFiles(sources, owned = []) {
  const files = Object.fromEntries(
    Object.entries(sources)
      .filter(([key]) => !key.startsWith('__'))
      .map(([key, text]) => [sourcePath(key), text]),
  );
  if (typeof owned === 'string') {
    try {
      owned = JSON.parse(owned);
    } catch {
      owned = [];
    }
  }
  const editorPaths = new Set([
    'main.lisp',
    'editor/graphics-tools.lisp',
    'editor/sound-tools.lisp',
    ...editorSourcePaths,
    ...Object.keys(generatorSources),
    ...(Array.isArray(owned) ? owned : []),
  ]);
  editorPaths.delete('game.lisp');
  for (const module of resolveModules(files, ['main.lisp'])) editorPaths.add(module.path);
  return {
    editor: Object.fromEntries(Object.entries(files).filter(([path]) => editorPaths.has(path))),
    game: Object.fromEntries(Object.entries(files).filter(([path]) => !editorPaths.has(path))),
  };
}
