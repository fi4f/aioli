import { readFileSync } from 'node:fs';
import { editorSourcePaths } from '../editor-sources.js';
import { exampleScenePaths, exampleToolPaths } from '../example-sources.js';
const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
export const generatorSources = Object.fromEntries(
  exampleToolPaths.map((path) => [path, read(path)]),
);
export const defaults = {
  main: read('main.lisp'),
  game: read('game.lisp'),
  ...generatorSources,
  ...Object.fromEntries(
    [...editorSourcePaths, ...exampleScenePaths].map((path) => [path, read(path)]),
  ),
};
