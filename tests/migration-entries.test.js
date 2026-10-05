import test from 'node:test';
import assert from 'node:assert/strict';
import { readProject, projectSnapshot } from '../project.js';

test('legacy entries migrate into main/game without exposing editor state to the game', () => {
  const app = '(init! :x 23)';
  const editor = '(init! :editor-private 99) (defn editor [] nil)';
  const saved = {
    version: 6,
    files: {
      'main.lisp': app,
      'editor.editor.lisp': editor,
      'editor/state.lisp': '(init! :ui-bg "#101613") (init! :menu false)',
    },
    state: {
      x: 23,
      'editor-private': 99,
      'ui-bg': '#123456',
      menu: false,
      tab: 'main',
      'open-tabs': '["main","editor"]',
    },
  };
  const loaded = readProject(saved, {});
  assert.equal(loaded.sources.game, app);
  assert.equal(loaded.sources.editor, undefined);
  assert.ok(loaded.sources.main.includes(editor));
  assert.ok(loaded.sources.main.includes('(defn draw [] (editor))'));
  assert.equal(loaded.applicationState.x, 23);
  assert.equal(loaded.applicationState['ui-bg'], undefined);
  assert.equal(loaded.applicationState['editor-private'], undefined);
  assert.equal(loaded.applicationState.menu, undefined);
  assert.deepEqual(JSON.parse(loaded.state['open-tabs']), ['game', 'main']);
  assert.equal(loaded.state.tab, 'game');
  const snapshot = projectSnapshot(
    loaded.sources,
    loaded.state,
    {},
    false,
    loaded.applicationState,
  );
  const reopened = readProject(snapshot, {});
  assert.deepEqual(reopened.applicationState, loaded.applicationState);
  assert.equal(reopened.sources.editor, undefined);
});

test('version 7 editor entry is folded into main while retaining custom entry code', () => {
  const loaded = readProject(
    {
      version: 7,
      files: {
        'main.lisp': '(init! :entry-setting 7) (import "./editor.lisp") (defn draw [] (editor))',
        'game.lisp': '(init! :x 2)',
        'editor.lisp': '(defn editor [] nil)',
      },
      state: { tab: 'editor', 'selected-file': 'editor.lisp' },
      applicationState: { x: 31 },
    },
    {},
  );
  assert.match(loaded.sources.main, /entry-setting/);
  assert.match(loaded.sources.main, /defn editor/);
  assert.equal(loaded.state.tab, 'main');
  assert.equal(loaded.state['selected-file'], 'main.lisp');
  assert.equal(loaded.applicationState.x, 31);
  assert.equal(loaded.sources.editor, undefined);
});

test('stock demos move into examples without moving customized scene files', () => {
  const stock = '(init! :radius 20) (defpixel render [p time] (background "#000000"))';
  const defaults = {
    'examples/garden.scene.lisp': stock,
    'examples/bloom.scene.lisp': stock,
    'examples/plasma.scene.lisp': stock,
  };
  const saved = {
    version: 8,
    files: {
      'main.lisp': '(defn draw [] nil)',
      'game.lisp': '(start-scene "scenes/garden.scene.lisp")',
      'scenes/garden.scene.lisp': stock,
      'scenes/bloom.scene.lisp': stock + '\n; custom',
    },
    state: { tab: 'scenes/garden.scene.lisp' },
    applicationState: { 'active-scene': 'scenes/garden.scene.lisp' },
  };
  const loaded = readProject(saved, defaults);
  assert.equal(loaded.sources['scenes/garden.scene.lisp'], undefined);
  assert.equal(loaded.sources['examples/garden.scene.lisp'], stock);
  assert.equal(loaded.sources['scenes/bloom.scene.lisp'], stock + '\n; custom');
  assert.match(loaded.sources.game, /examples\/garden/);
  assert.equal(loaded.state.tab, 'examples/garden.scene.lisp');
  assert.equal(loaded.applicationState['active-scene'], 'examples/garden.scene.lisp');
});

test('current saves relocate stock root Bloom without duplicating its examples path', () => {
  const stock = '(defpixel render [p time] (background "#000000"))';
  const loaded = readProject(
    {
      version: 10,
      files: {
        'main.lisp': '',
        'game.lisp': '(start-scene "bloom.scene.lisp")',
        'bloom.scene.lisp': stock,
        'examples/bloom.scene.lisp': stock,
      },
      state: { tab: 'bloom.scene.lisp' },
      applicationState: { 'active-scene': 'bloom.scene.lisp' },
    },
    { 'examples/bloom.scene.lisp': stock },
  );
  assert.equal(loaded.sources['bloom.scene.lisp'], undefined);
  assert.equal(loaded.sources.game, '(start-scene "examples/bloom.scene.lisp")');
  assert.equal(loaded.state.tab, 'examples/bloom.scene.lisp');
  assert.equal(loaded.applicationState['active-scene'], 'examples/bloom.scene.lisp');
});
