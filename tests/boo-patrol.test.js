import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeSource } from '../source-text.js';
import { parse } from '../lisp.js';
import { engineServices } from '../engine-services.js';
import { stageScene } from '../scenes.js';
import { projectSnapshot, readProject } from '../project.js';

const path = 'examples/boo-patrol.scene.lisp';
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

test('Boo Patrol collision, controls, damage and restart work with ordinary engine services', () => {
  const { state, keys, runtime } = game();
  for (let i = 0; i < 3; i++) state[`boo-enemy-${i}-hp`] = 0;
  keys.add('w');
  for (let i = 0; i < 200; i++) runtime.call('update', 0.05);
  assert.ok(state['boo-x'] > 8.5 && state['boo-x'] < 8.83, 'stops against outer wall');
  keys.clear();
  keys.add('ArrowRight');
  runtime.call('update', 0.05);
  assert.ok(state['boo-angle'] > 0);
  keys.clear();
  keys.add('r');
  runtime.call('update', 0.05);
  assert.equal(state['boo-x'], 1.5);
  assert.equal(state['boo-health'], 100);
  keys.clear();
  state['boo-enemy-0-x'] = 1.8;
  runtime.call('update', 0.05);
  assert.equal(state['boo-health'], 88);
  runtime.call('update', 0.05);
  assert.equal(state['boo-health'], 88, 'contact damage has a cooldown');
  state['boo-health'] = 0;
  keys.add('w');
  runtime.call('update', 0.05);
  assert.equal(state['boo-x'], 1.5, 'dead players cannot move');
});

test('Boo Patrol shots hit the nearest visible monster, obey walls, and unlock the exit', () => {
  const { state, runtime, sounds, keys } = game();
  for (let i = 0; i < 3; i++) {
    state[`boo-enemy-${i}-x`] = 4.5 + i;
    state[`boo-enemy-${i}-y`] = 1.5;
  }
  runtime.call('boo-fire');
  assert.equal(state['boo-enemy-0-hp'], 1);
  assert.equal(state['boo-enemy-1-hp'], 2);
  for (let i = 0; i < 5; i++) runtime.call('boo-fire');
  assert.equal(state['boo-kills'], 3);
  assert.equal(state['boo-won'], false);
  state['boo-x'] = 8.5;
  state['boo-y'] = 8.5;
  runtime.call('update', 0.016);
  assert.equal(state['boo-won'], true);
  assert.ok(sounds.includes('boo-victory'));
  keys.add('r');
  runtime.call('update', 0.016);
  keys.clear();
  state['boo-y'] = 2.5;
  state['boo-enemy-0-y'] = 2.5;
  runtime.call('boo-fire');
  assert.equal(state['boo-enemy-0-hp'], 2, 'stone wall blocks shots');
  keys.add(' ');
  runtime.call('update', 0.016);
  assert.equal(
    sounds.filter((s) => s === 'boo-lantern').length,
    7,
    'held trigger respects cooldown',
  );
  assert.equal(runtime.collectSound('boo-lantern').length, 2);
});

test('Boo Patrol render stays within the standard budget across the walkable maze', () => {
  const { runtime, state } = game();
  const application = engineServices().create(state);
  const scene = stageScene({ [path]: source }, path, application, () =>
    engineServices().create(state),
  );
  assert.equal(scene.runtime.global.render.hook.kind, 'draw');
  const before = { ...state };
  for (let y = 1; y < 9; y++)
    for (let x = 1; x < 9; x++) {
      if (runtime.call('boo-wall?', x, y)) continue;
      state['boo-x'] = x + 0.5;
      state['boo-y'] = y + 0.5;
      for (const angle of [0, 0.7854, 1.5708, 3.14159, -1.5708]) {
        state['boo-angle'] = angle;
        const commands = runtime.drawFrame().commands;
        assert.ok(commands.length > 100 && commands.length < 300);
      }
    }
  Object.assign(state, before);
  runtime.drawFrame();
  assert.deepEqual(state, before, 'drawing does not mutate inspector state');
});

test('Boo Patrol traces the world and sprite depth on the GPU without CPU column rays', () => {
  const { runtime, state } = game();
  state['boo-enemy-0-x'] = 4;
  state['boo-enemy-0-y'] = 1.5;
  state['boo-enemy-1-hp'] = 0;
  state['boo-enemy-2-hp'] = 0;
  runtime.global['boo-ray'] = () => {
    throw new Error('CPU visibility ray during drawing');
  };
  const commands = runtime.drawFrame().commands;
  const pixels = commands.filter((command) => command.pixel);
  assert.equal(pixels.length, 2, 'one world pass and one visible enemy quad');
  assert.equal(new Set(pixels.map((command) => command.pixel.shader.code)).size, 2);
  assert.deepEqual(pixels[0].clip, [0, 0, 320, 240]);
  for (const command of pixels) assert.match(command.pixel.shader.pixelBody, /gridRay_/);
  const ground = 100 + 121.2121 / 2.5;
  assert.ok(
    Math.abs(pixels[1].clip[1] + pixels[1].clip[3] - ground) < 0.001,
    'sprite feet meet the projected ground plane',
  );
  assert.ok(
    commands.every((command) =>
      command.color.slice(0, 3).every((value) => value >= 0 && value <= 1),
    ),
  );
});

test('Boo Patrol HUD and end screens use full-size glyphs on whole pixel boundaries', () => {
  for (const [width, height] of [
    [320, 240],
    [640, 360],
    [641, 359],
    [640, 480],
  ]) {
    const state = {},
      runtime = engineServices({ size: () => [width, height] }).create(state);
    runtime.load(parse(source));
    runtime.call('enter');
    for (const dead of [false, true]) {
      state['boo-health'] = dead ? 0 : 100;
      const glyphs = runtime
        .drawFrame(width, height)
        .commands.filter((command) => command.meta[0] === 3);
      assert.ok(glyphs.length > 30);
      for (const glyph of glyphs) {
        assert.ok(glyph.bounds[2] >= 8 && glyph.bounds[2] % 8 === 0);
        assert.ok(glyph.bounds[3] >= 18 && glyph.bounds[3] % 18 === 0);
        assert.ok(glyph.bounds.every(Number.isInteger), 'glyphs align to the logical pixel grid');
      }
    }
  }
});
