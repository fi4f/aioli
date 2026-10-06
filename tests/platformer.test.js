import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '../lisp.js';
import { engineServices } from '../engine-services.js';
const source = readFileSync(new URL('../examples/platformer.scene.lisp', import.meta.url), 'utf8');
function game() {
  const state = {},
    keys = new Set(),
    sounds = [];
  const runtime = engineServices({
    key: (key) => keys.has(key),
    playSound: (name) => sounds.push(name),
  }).create(state);
  runtime.load(parse(source));
  runtime.call('enter');
  const step = (frames = 1) => {
    for (let i = 0; i < frames; i++) runtime.call('update', 1 / 60);
  };
  return { state, keys, sounds, runtime, step };
}
test('Moonlit Mail supports grounded motion, variable jump height and coin blocks', () => {
  const { state, keys, runtime, step } = game();
  step(10);
  assert.equal(state['peak-y'], 192);
  assert.equal(state['peak-grounded'], true);
  keys.add('d');
  step(20);
  keys.clear();
  assert.ok(state['peak-x'] > 50);
  keys.add(' ');
  step(1);
  assert.ok(state['peak-vy'] < 0);
  assert.ok(state['peak-y'] < 192);
  keys.clear();
  step(1);
  assert.ok(state['peak-vy'] >= -95);
  state['peak-x'] = 150;
  state['peak-y'] = 176;
  state['peak-vy'] = -200;
  runtime.call('peak-step', 0.02);
  assert.equal(state['peak-coins'], 1);
  assert.equal(runtime.call('peak-tile', 9, 10), 4);
  runtime.call('peak-bump', 150, 159);
  assert.equal(state['peak-coins'], 1);
});

test('Moonlit Mail jump can reach the four-tile-high platforms and their coins', () => {
  const { state, keys, step } = game();
  state['peak-x'] = 400;
  state['peak-ghost-1-alive'] = false;
  keys.add(' ');
  let highest = state['peak-y'];
  // Jump beside the platform rather than into its underside.
  state['peak-x'] = 380;
  for (let i = 0; i < 35; i++) {
    step();
    highest = Math.min(highest, state['peak-y']);
  }
  assert.ok(highest + 16 < 144, 'feet rise above the four-tile-high platform');
});

test('Moonlit Mail allows ledge grace jumps and buffers a jump just before landing', () => {
  const ledge = game();
  ledge.state['peak-x'] = 289;
  ledge.step();
  assert.equal(ledge.state['peak-grounded'], false);
  ledge.keys.add(' ');
  ledge.step();
  assert.ok(ledge.state['peak-vy'] < 0);
  const landing = game();
  Object.assign(landing.state, {
    'peak-x': 50,
    'peak-y': 179,
    'peak-vy': 180,
    'peak-coyote': 0,
    'peak-grounded': false,
  });
  landing.keys.add(' ');
  for (let i = 0; i < 10 && landing.state['peak-vy'] >= 0; i++) landing.step();
  assert.ok(landing.state['peak-vy'] < 0, 'buffered jump fires after landing');
});
test('Moonlit Mail pits respawn at checkpoints, stomps bounce, and restart resets progress', () => {
  const { state, keys, runtime, step } = game();
  state['peak-x'] = 600;
  step();
  assert.equal(state['peak-checkpoint'], true);
  state['peak-y'] = 280;
  step();
  assert.equal(state['peak-x'], 592);
  assert.equal(state['peak-lives'], 2);
  state['peak-x'] = state['peak-ghost-0-x'];
  state['peak-y'] = 178;
  state['peak-vy'] = 180;
  state['peak-invincible'] = 0;
  step(4);
  assert.equal(state['peak-ghost-0-alive'], false);
  assert.ok(state['peak-vy'] < 0);
  keys.add('r');
  step();
  assert.equal(state['peak-x'], 32);
  assert.equal(state['peak-lives'], 3);
  assert.equal(state['peak-checkpoint'], false);
  assert.equal(state['peak-ghost-0-alive'], true);
  state['peak-x'] = 1250;
  step();
  assert.equal(state['peak-won'], true);
});
test('Moonlit Mail render is bounded and does not mutate gameplay state', () => {
  const { state, runtime } = game();
  for (const camera of [0, 250, 600, 992]) {
    state['peak-camera'] = camera;
    state['peak-x'] = camera + 100;
    const before = structuredClone(state);
    const draw = runtime.drawFrame();
    assert.ok(draw.commands.length > 150 && draw.commands.length < 1500);
    assert.deepEqual(state, before);
  }
});

test('Moonlit Mail can be completed through real running and jumping inputs without teleporting', () => {
  const { state, keys, runtime, step } = game();
  keys.add('d');
  keys.add('x');
  for (let frame = 0; frame < 1500 && !state['peak-won'] && !state['peak-over']; frame++) {
    const x = state['peak-x'];
    const hazard =
      !runtime.call('peak-solid?', x + 38, 209) ||
      [0, 1, 2, 3].some(
        (i) =>
          state[`peak-ghost-${i}-alive`] &&
          state[`peak-ghost-${i}-x`] - x > -8 &&
          state[`peak-ghost-${i}-x`] - x < 30,
      );
    if (state['peak-grounded'] && hazard) keys.add(' ');
    else if (state['peak-vy'] >= 0) keys.delete(' ');
    step();
  }
  assert.equal(state['peak-won'], true);
  assert.equal(state['peak-checkpoint'], true);
  assert.equal(state['peak-lives'], 3);
});
