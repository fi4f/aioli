import test from 'node:test';
import assert from 'node:assert/strict';
import {
  launchApplication,
  stageApplication,
  updateApplication,
  drawApplication,
} from '../application.js';
import { stageScene, selectScene } from '../scenes.js';
import { engineServices } from '../engine-services.js';

test('scene definitions are private while state and ordinary application helpers are shared', () => {
  const state = {};
  const makeRuntime = () => engineServices().create(state);
  const root = launchApplication({
    files: { 'main.lisp': '(init! :steps 0) (defn helper [] 7)' },
    state,
    makeRuntime,
  });
  const a = stageScene(
    { 'a.lisp': '(defn tag [] "A") (defdraw render [] (fill "#ff0000") (rect [0 0] [2 2]))' },
    'a.lisp',
    root,
    makeRuntime,
  );
  const b = stageScene(
    { 'b.lisp': '(defn tag [] "B") (defdraw render [] (fill "#ffffff") (circle [4 4] (helper)))' },
    'b.lisp',
    root,
    makeRuntime,
  );
  assert.equal(a.runtime.call('tag'), 'A');
  assert.equal(b.runtime.call('tag'), 'B');
  assert.equal(root.global.tag, undefined);
  assert.equal(b.runtime.drawFrame().commands[0].bounds[2], 14);
  assert.throws(
    () => stageScene({ 'missing.lisp': '' }, 'missing.lisp', root, makeRuntime),
    /defdraw render/,
  );
});
test('editor and standalone hosts share scene entry, reload, exit, update and command composition', () => {
  const files = {
    'main.lisp': '(init! :log "") (defdraw render [] (fill "#ffffff") (rect [0 0] [2 2]))',
    'a.lisp':
      '(defn enter [] (set! :log (str (get :log) "A"))) (defn exit [] (set! :log (str (get :log) "X"))) (defn update [dt] (set! :dt dt)) (defdraw render [] (fill "#ff0000") (rect [2 2] [2 2]))',
    'b.lisp':
      '(defn enter [] (set! :log (str (get :log) "B"))) (defdraw render [] (fill "#00ff00") (rect [4 4] [2 2]))',
  };
  const makeRuntime = (state) => engineServices().create(state),
    state = {};
  const a = stageApplication({
    files,
    state,
    makeRuntime,
    explicitScene: 'a.lisp',
    activating: true,
  });
  assert.equal(state.log, 'A');
  updateApplication(a, 0.1);
  assert.equal(state.dt, 0.1);
  assert.equal(drawApplication(a, [320, 240]).commands.length, 2);
  const reload = stageApplication({
    files,
    state: { ...state },
    makeRuntime,
    lifecycle: 'reload',
    previous: a,
    explicitScene: 'a.lisp',
  });
  assert.equal(reload.runtime.state.log, 'A');
  assert.equal(reload.changed, false);
  const b = stageApplication({
    files,
    state: { ...state },
    makeRuntime,
    lifecycle: '',
    previous: a,
    explicitScene: 'b.lisp',
  });
  assert.equal(b.runtime.state.log, 'AXB');
  assert.equal(state.log, 'A');
});
test('entry changes select startup scenes while unrelated reloads preserve requested transitions', () => {
  assert.equal(selectScene({ requested: 'a', previousRequest: 'a', active: 'b' }), 'b');
  assert.equal(selectScene({ requested: 'a', previousRequest: 'b', active: 'b' }), 'a');
  assert.equal(selectScene({ explicit: 'c', requested: 'a', active: 'b' }), 'c');
});
