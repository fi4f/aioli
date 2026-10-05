import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { launchApplication } from '../application.js';
import { engineServices } from '../engine-services.js';
import { applicationFiles } from '../application-files.js';
import { stageScene } from '../scenes.js';
import { exportHTML } from '../html-export.js';

test('application instances isolate modules, state, definitions and capabilities', () => {
  const gameState = {};
  const game = launchApplication({
    files: { 'game.lisp': '(init! :value 3) (defn update [dt] (set! :value (+ (get :value) dt)))' },
    entry: 'game.lisp',
    state: gameState,
    services: engineServices(),
  });
  const editor = launchApplication({
    files: { 'main.lisp': '(init! :private 42) (defn read-game [] (game-get :value))' },
    services: { primitives: { 'game-get': (key) => gameState[key] } },
  });
  assert.equal(editor.call('read-game'), 3);
  game.call('update', 2);
  assert.equal(editor.call('read-game'), 5);
  assert.equal(gameState.private, undefined);
  assert.equal(game.global['game-get'], undefined);
  assert.equal(game.global['read-game'], undefined);
  assert.throws(
    () => launchApplication({ files: game.files, entry: 'main.lisp' }),
    /Missing import/,
  );
});

test('scene loading has no filename suffix restrictions', () => {
  const state = {};
  const scene = stageScene(
    { 'level.lisp': '(init! :value 7) (defdraw render [] (background "#123456"))' },
    'level.lisp',
    launchApplication({ files: { 'main.lisp': '' }, state }),
    () => engineServices().create(state),
  );
  assert.equal(scene.runtime.state.value, 7);
});

test('editor code is omitted from game stores while dynamically selected modules remain', () => {
  const sources = {
    main: '(defn draw [] nil)',
    game: '(start-scene "level.lisp")',
    'level.lisp': '; dynamically loaded',
    'assets/test.generator.lisp': '; retained',
  };
  const stores = applicationFiles(sources);
  assert.ok(stores.game['level.lisp']);
  assert.ok(stores.game['assets/test.generator.lisp']);
  assert.equal(stores.game['editor.lisp'], undefined);
  assert.equal(stores.game['main.lisp'], undefined);
});

test('HTML export embeds the engine and all project files without editor dependencies', async () => {
  const html = await exportHTML(
    { 'game.lisp': '; </script> literal', 'unused.lisp': '; keep' },
    {},
    (path) => readFile(new URL('../' + path, import.meta.url), 'utf8'),
  );
  assert.ok(html.includes('unused.lisp'));
  assert.ok(html.includes('game.lisp'));
  assert.ok(html.includes('standalone.js'));
  for (const path of [
    'editor/workspace.lisp',
    'editor-policy.js',
    'hook-definitions.js',
    'inspector-fields.js',
  ])
    assert.equal(html.includes(path), false, path);
  assert.equal((html.match(/<\/script>/g) ?? []).length, 1);
  assert.equal(html.includes('src="'), false);
});

test('explicit editor ownership keeps backup sources out of exported game stores', () => {
  const stores = applicationFiles(
    {
      main: '(defn draw [] nil)',
      game: '',
      'main-backup-1.lisp': '(defn private-editor-function [] nil)',
    },
    ['main-backup-1.lisp'],
  );
  assert.ok('main-backup-1.lisp' in stores.editor);
  assert.equal(stores.game['main-backup-1.lisp'], undefined);
});
