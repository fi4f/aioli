import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeSource } from '../source-text.js';
import { parse } from '../lisp.js';
import { engineServices } from '../engine-services.js';
import { stageScene } from '../scenes.js';
import { projectSnapshot, readProject } from '../project.js';

const path = 'examples/doom.scene.lisp';
const source = readFileSync(new URL('../' + path, import.meta.url), 'utf8');
function game() {
  const state = {},
    keys = new Set(),
    sounds = [];
  const services = engineServices({
    key: (key) => keys.has(key),
    playSound: (name) => sounds.push(name),
  });
  const runtime = services.create(state);
  runtime.load(parse(source));
  runtime.call('enter');
  return { state, keys, sounds, runtime };
}

test('Tiny Crypt collision, controls, damage and restart work with ordinary engine services', () => {
  const { state, keys, runtime } = game();
  for (let i = 0; i < 3; i++) state[`doom-enemy-${i}-hp`] = 0;
  keys.add('w');
  for (let i = 0; i < 200; i++) runtime.call('update', 0.05);
  assert.ok(state['doom-x'] > 8.5 && state['doom-x'] < 8.83, 'stops against outer wall');
  keys.clear();
  keys.add('ArrowRight');
  runtime.call('update', 0.05);
  assert.ok(state['doom-angle'] > 0);
  keys.clear();
  keys.add('r');
  runtime.call('update', 0.05);
  assert.equal(state['doom-x'], 1.5);
  assert.equal(state['doom-health'], 100);
  keys.clear();
  state['doom-enemy-0-x'] = 1.8;
  runtime.call('update', 0.05);
  assert.equal(state['doom-health'], 88);
  runtime.call('update', 0.05);
  assert.equal(state['doom-health'], 88, 'contact damage has a cooldown');
  state['doom-health'] = 0;
  keys.add('w');
  runtime.call('update', 0.05);
  assert.equal(state['doom-x'], 1.5, 'dead players cannot move');
});

test('Tiny Crypt shots hit the nearest visible monster, obey walls, and unlock the exit', () => {
  const { state, runtime, sounds, keys } = game();
  for (let i = 0; i < 3; i++) {
    state[`doom-enemy-${i}-x`] = 4.5 + i;
    state[`doom-enemy-${i}-y`] = 1.5;
  }
  runtime.call('doom-fire');
  assert.equal(state['doom-enemy-0-hp'], 1);
  assert.equal(state['doom-enemy-1-hp'], 2);
  for (let i = 0; i < 5; i++) runtime.call('doom-fire');
  assert.equal(state['doom-kills'], 3);
  assert.equal(state['doom-won'], false);
  state['doom-x'] = 8.5;
  state['doom-y'] = 8.5;
  runtime.call('update', 0.016);
  assert.equal(state['doom-won'], true);
  assert.ok(sounds.includes('doom-victory'));
  keys.add('r');
  runtime.call('update', 0.016);
  keys.clear();
  state['doom-y'] = 2.5;
  state['doom-enemy-0-y'] = 2.5;
  runtime.call('doom-fire');
  assert.equal(state['doom-enemy-0-hp'], 2, 'stone wall blocks shots');
  keys.add(' ');
  runtime.call('update', 0.016);
  assert.equal(
    sounds.filter((s) => s === 'doom-pistol').length,
    7,
    'held trigger respects cooldown',
  );
  assert.equal(runtime.collectSound('doom-pistol').length, 2);
});

test('Tiny Crypt render stays within the standard budget across the walkable maze', () => {
  const { runtime, state } = game();
  const application = engineServices().create(state);
  const scene = stageScene({ [path]: source }, path, application, () =>
    engineServices().create(state),
  );
  assert.equal(scene.runtime.global.render.hook.kind, 'draw');
  const before = { ...state };
  for (let y = 1; y < 9; y++)
    for (let x = 1; x < 9; x++) {
      if (runtime.call('doom-wall?', x, y)) continue;
      state['doom-x'] = x + 0.5;
      state['doom-y'] = y + 0.5;
      for (const angle of [0, 0.7854, 1.5708, 3.14159, -1.5708]) {
        state['doom-angle'] = angle;
        const commands = runtime.drawFrame().commands;
        assert.ok(commands.length > 200 && commands.length < 1000);
      }
    }
  Object.assign(state, before);
  runtime.drawFrame();
  assert.deepEqual(state, before, 'drawing does not mutate inspector state');
});
