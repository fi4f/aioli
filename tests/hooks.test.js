import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, createRuntime } from '../lisp.js';
import { engineServices } from '../engine-services.js';
import { sourceHooks } from '../hook-definitions.js';
import { previewHook } from '../hook-preview.js';

const source = `(init! :changed 0)
(defdraw dot [x y] ["Dot" [30 40] [100 80]] (fill "#ff0000") (circle [x y] 5) (set! :changed (+ (get :changed) 1)))
(defdraw pair [] (scope (dot 10 20)) (scope (dot 60 20)))
(defn draw [] (pair))
(defsound tone [pitch] ["Tone" [440]] (voice :sine pitch pitch 0.2 0.3))
(defsound hit [] ["Hit"] (voice :noise 100 40 0.1 0.2) (tone 80))`;

test('drawing and sound hooks are ordinary composable functions with validated metadata', () => {
  const hooks = sourceHooks(parse(source));
  assert.deepEqual(hooks[0].defaults, [30, 40]);
  assert.deepEqual(hooks[0].size, [100, 80]);
  const runtime = engineServices().create({});
  runtime.load(parse(source));
  assert.equal(runtime.drawFrame(100, 80).commands.length, 2);
  assert.equal(runtime.state.changed, 2);
  assert.equal(runtime.collectSound('hit').length, 2);
  assert.equal(runtime.collectSound('tone', 220)[0].start, 220);
  assert.throws(() => runtime.collectSound('dot'), /Missing sound hook/);
  assert.throws(
    () => sourceHooks(parse('(defdraw bad [x] ["Bad" []] (circle [x 0] 2))')),
    /defaults/,
  );
  assert.throws(
    () => sourceHooks(parse('(defdraw bad [] ["Bad" [] [0 100]] (circle [0 0] 2))')),
    /canvas/,
  );
});

test('independent previews preserve live state, resolve imports and run only the selected hook', () => {
  const state = { changed: 7 };
  const files = {
    'game.lisp': '(defn update [dt] (set! :changed 999))',
    'art/hooks.lisp': '(import "../helpers.lisp")' + source,
    'helpers.lisp': '(defn helper [] 1)',
  };
  const result = previewHook({
    files,
    entry: 'game.lisp',
    path: 'art/hooks.lisp',
    name: 'dot',
    state,
  });
  assert.equal(state.changed, 7);
  assert.equal(result.state.changed, 8);
  assert.equal(result.draw.commands.length, 1);
  assert.deepEqual(result.draw.commands[0].bounds, [25, 35, 10, 10]);
  const again = previewHook({ files, path: 'art/hooks.lisp', name: 'dot', state, args: [10, 20] });
  assert.deepEqual(again.draw.commands[0].bounds, [5, 15, 10, 10]);
  const sound = previewHook({ files, path: 'art/hooks.lisp', name: 'hit', state });
  assert.equal(sound.pcm.length, 9702);
  assert.ok(sound.pcm.some((n) => n !== 0));
  assert.equal(state.changed, 7);
});

test('play-sound forwards a named hook and arguments synchronously to its host', () => {
  const played = [];
  let runtime;
  const services = engineServices({
    playSound: (name, ...args) => played.push(runtime.collectSound(name, ...args)),
  });
  runtime = services.create({});
  runtime.load(parse(source));
  runtime.load(parse('(play-sound :tone 220) (play-sound :tone 880)'));
  assert.deepEqual(
    played.map((patch) => patch[0].start),
    [220, 880],
  );
  const ordinary = createRuntime({}, { playSound: (...args) => played.push(args) });
  ordinary.load(parse('(play-sound)'));
  assert.deepEqual(played.at(-1), []);
});
