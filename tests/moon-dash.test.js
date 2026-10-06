import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { engineServices } from '../engine-services.js';
import { parse } from '../lisp.js';

const source = readFileSync(new URL('../examples/moon-dash.scene.lisp', import.meta.url), 'utf8');
function game() {
  const keys = new Set(),
    sounds = [],
    pointer = { down: false, pressed: false };
  const runtime = engineServices({
    key: (key) => keys.has(key),
    pointer: () => pointer,
    playSound: (name) => sounds.push(name),
  }).create({});
  runtime.load(parse(source));
  runtime.call('enter');
  const step = (frames = 1) => {
    for (let i = 0; i < frames; i++) runtime.call('update', 1 / 60);
  };
  return { runtime, state: runtime.state, keys, sounds, pointer, step };
}

test('runner waits for input, starts with keyboard/pointer, jumps and emits procedural beats', () => {
  const { state, keys, sounds, step } = game();
  step(10);
  assert.equal(state['dash-distance'], 0);
  keys.add(' ');
  step();
  keys.clear();
  assert.ok(state['dash-distance'] > 0 && state['dash-vy'] < 0);
  step(45);
  assert.equal(state['dash-grounded'], true);
  assert.ok(sounds.includes('dash-jump') && sounds.includes('dash-beat'));
  const touch = game();
  touch.pointer.pressed = true;
  touch.step();
  assert.equal(touch.state['dash-running'], true);
});

test('spikes and pits cause one death, restart preserves best progress and counts attempts', () => {
  const run = game();
  run.keys.add(' ');
  run.step();
  run.keys.clear();
  run.step(200);
  assert.equal(run.state['dash-dead'], true);
  assert.equal(run.sounds.filter((name) => name === 'dash-crash').length, 1);
  const best = run.state['dash-best'];
  assert.ok(best > 0);
  const stopped = run.state['dash-distance'];
  run.step(20);
  assert.equal(run.state['dash-distance'], stopped);
  run.keys.add('r');
  run.step(5);
  assert.equal(run.state['dash-attempt'], 2);
  assert.equal(run.state['dash-best'], best);
  assert.equal(run.state['dash-dead'], false);
  assert.equal(run.state['dash-distance'], 0);
  run.keys.clear();
  run.state['dash-running'] = true;
  run.state['dash-distance'] = 730;
  run.step(80);
  assert.equal(run.state['dash-dead'], true);
});

test('blocks support landing from above while side collisions are fatal', () => {
  const landing = game();
  Object.assign(landing.state, {
    'dash-distance': 370,
    'dash-y': 155,
    'dash-vy': 100,
    'dash-running': true,
  });
  landing.step(5);
  assert.equal(landing.state['dash-y'], 160);
  assert.equal(landing.state['dash-grounded'], true);
  assert.equal(landing.state['dash-dead'], false);
  const side = game();
  Object.assign(side.state, { 'dash-distance': 355, 'dash-running': true });
  side.step(8);
  assert.equal(side.state['dash-dead'], true);
});

test('the whole chart is beatable using real jump inputs at all supported tempos', () => {
  for (const bpm of [80, 120, 160]) {
    const run = game();
    run.state['dash-bpm'] = bpm;
    run.keys.add(' ');
    run.step();
    run.keys.clear();
    for (
      let frame = 0;
      frame < 2200 && !run.state['dash-won'] && !run.state['dash-dead'];
      frame++
    ) {
      const x = run.state['dash-distance'] + 64;
      const ahead = run.state['dash-level'].find(([beat]) => beat * 72 > x + 2);
      if (run.state['dash-grounded'] && ahead && ahead[0] * 72 - x < 44) run.keys.add(' ');
      else run.keys.delete(' ');
      run.step();
    }
    assert.equal(
      run.state['dash-won'],
      true,
      `${bpm} BPM stopped at ${run.state['dash-distance']}`,
    );
    assert.equal(run.state['dash-best'], 100);
  }
});

test('rendering stays bounded and pure; each sound hook produces a valid patch', () => {
  const { runtime, state } = game();
  for (const distance of [0, 650, 1500, 2850]) {
    state['dash-distance'] = distance;
    const before = structuredClone(state);
    const list = runtime.drawFrame(640, 480);
    assert.ok(list.commands.length < 500);
    assert.deepEqual(state, before);
  }
  for (const name of ['dash-jump', 'dash-crash', 'dash-beat', 'dash-finish'])
    assert.ok(runtime.collectSound(name).length > 0);
});
