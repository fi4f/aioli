import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planFolderMove,
  validateFolderPath,
  savedFolders,
  folderPaths,
} from '../folder-operations.js';
import { projectTree } from '../file-tree.js';
import { resolveModules } from '../module-loader.js';

test('empty folders appear in the tree without placeholder resources', () => {
  const rows = projectTree([], ['art'], ['art/empty']);
  assert.deepEqual(
    rows.map((row) => row[0]),
    ['art', 'art/empty'],
  );
  assert.deepEqual(savedFolders(['art/empty', 'art/empty']), ['art/empty']);
  assert.equal(folderPaths({}, {}, ['art/empty']).has('art'), true);
});

test('folder moves rewrite nested imports, external references and constructed asset prefixes', () => {
  const sources = {
    game: '(import "./old/helper.lisp") (start-scene "old/scenes/level.scene.lisp")',
    'old/helper.lisp': '(import "./scenes/other.lisp") (defn helper [] 1)',
    'old/scenes/other.lisp': '(defn other [] 2)',
    'old/scenes/level.scene.lisp': '(import "../helper.lisp") (resource-url "old/asset.png")',
    main: '(str "old/" "asset.png") ; leave old/ untouched',
  };
  const resources = { 'old/asset.png': { data: 'bytes' } };
  const plan = planFolderMove(sources, resources, ['old/empty'], 'old', 'art/new');
  assert.equal(plan.sources['old/helper.lisp'], undefined);
  assert.equal(
    resolveModules(plan.sources, ['art/new/scenes/level.scene.lisp']).at(-1).path,
    'art/new/scenes/level.scene.lisp',
  );
  assert.ok(plan.sources.game.includes('art/new/scenes/level.scene.lisp'));
  assert.ok(plan.sources.main.includes('"art/new/"'));
  assert.ok(plan.sources.main.includes('; leave old/ untouched'));
  assert.equal(plan.resources['art/new/asset.png'].data, 'bytes');
  assert.ok(plan.folders.includes('art/new/empty'));
  assert.ok(plan.folders.includes('art'));
  assert.ok(sources['old/helper.lisp']);
  assert.ok(resources['old/asset.png']);
});

test('folder actions reject collisions, cycles and file ancestors before changing data', () => {
  const sources = { 'old/a.lisp': '', 'file.lisp': '' };
  assert.throws(() => planFolderMove(sources, {}, [], 'old', 'old/child'), /itself/);
  assert.throws(() => planFolderMove(sources, {}, ['taken'], 'old', 'taken'), /exists/);
  assert.throws(() => validateFolderPath(sources, {}, [], 'file.lisp/sub'), /file/);
  assert.throws(() => validateFolderPath(sources, {}, [], 'old'), /exists/);
  assert.equal(planFolderMove({}, {}, ['empty'], 'empty', 'new').folders[0], 'new');
});
