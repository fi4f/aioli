import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../lisp.js';
import { stageScene, callHook, isScenePath, selectScene } from '../scenes.js';
import { compileShader } from '../shader.js';
import { defaults } from '../examples.js';
import { assetKind } from '../file-tree.js';

const scene = (tag, color) => `(defn tag [] "${tag}")
(defn init [] (init! :updates 0))
(defn enter [] (set! :tag (tag)))
(defn update [dt] (set! :updates (+ (get :updates) (twice dt))))
(defn exit [] (set! :left (tag)))
(defpixel render [p time] (background "${color}"))`;

test('scenes isolate lifecycle functions and share application state/helpers', () => {
  const state = {},
    application = createRuntime(state);
  application.global.twice = (x) => x * 2;
  application.global.update = () => {
    state.application = true;
  };
  const sources = {
    'levels/a.scene.lisp': scene('A', '#ff0000'),
    'levels/b.scene': scene('B', '#0000ff'),
  };
  const a = stageScene(sources, 'levels/a.scene.lisp', application, () => createRuntime(state));
  callHook(a.runtime, 'init');
  callHook(a.runtime, 'enter');
  callHook(a.runtime, 'update', 0.5);
  assert.equal(state.tag, 'A');
  assert.equal(state.updates, 1);
  assert.equal(application.global.tag, undefined);
  assert.equal(state.application, undefined);
  const b = stageScene(sources, 'levels/b.scene', application, () => createRuntime(state));
  callHook(a.runtime, 'exit');
  callHook(b.runtime, 'init');
  callHook(b.runtime, 'enter');
  assert.equal(state.left, 'A');
  assert.equal(state.tag, 'B');
  assert.equal(a.runtime.call('tag'), 'A');
  assert.equal(b.runtime.call('tag'), 'B');
  assert.match(compileShader(b.render, state).code, /@fragment/);
});

test('scene resources require a render hook; suffix conventions belong to the editor', () => {
  assert.equal(isScenePath('menu.scene.lisp'), true);
  assert.equal(isScenePath('menu.scene'), true);
  assert.equal(isScenePath('menu.lisp'), false);
  const application = createRuntime({});
  assert.throws(
    () => stageScene({ 'menu.lisp': '' }, 'menu.lisp', application, () => createRuntime({})),
    /defpixel render/,
  );
  assert.throws(
    () =>
      stageScene({ 'menu.scene': '(defn update [dt] nil)' }, 'menu.scene', application, () =>
        createRuntime({}),
      ),
    /defpixel render/,
  );
});

test('examples contain named scenes without legacy magic files; entry icons are distinct', () => {
  assert.ok(defaults.main.includes('start-scene'));
  for (const path of ['game', 'audio', 'scene', 'ui']) assert.equal(path in defaults, false);
  assert.ok(defaults['scenes/garden.scene.lisp'].includes('defpixel render'));
  assert.equal(assetKind('main.lisp', 'lisp'), 'editor-entry');
  assert.equal(assetKind('editor.lisp', 'lisp'), 'code');
  assert.equal(assetKind('levels/menu.scene', 'lisp'), 'scene');
});

test('entry scene changes override saved state while unrelated reloads preserve runtime transitions', () => {
  const garden = 'scenes/garden.scene.lisp',
    bloom = 'scenes/bloom.scene.lisp';
  assert.equal(selectScene({ requested: bloom, previousRequest: garden, active: garden }), bloom);
  assert.equal(selectScene({ requested: garden, previousRequest: garden, active: bloom }), bloom);
  assert.equal(selectScene({ requested: bloom, active: garden, activating: true }), bloom);
  assert.equal(
    selectScene({ requested: garden, previousRequest: garden, active: bloom, activating: true }),
    bloom,
  );
  assert.equal(selectScene({ explicit: garden, requested: bloom, active: bloom }), garden);
  assert.equal(selectScene({ explicit: '', requested: bloom, active: bloom }), '');
  assert.equal(selectScene({ requested: undefined, previousRequest: garden, active: garden }), '');
});
