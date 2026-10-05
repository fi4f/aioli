import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, createRuntime } from '../lisp.js';
import { DrawList, binCommands } from '../drawing.js';
import { defaults } from '../examples.js';
const uiSource = readFileSync(new URL('../ui.lisp', import.meta.url), 'utf8');
const editorSource = readFileSync(new URL('../editor.lisp', import.meta.url), 'utf8');
function editor(width = 1440, height = 900) {
  const draw = new DrawList(width, height),
    state = {},
    regions = [];
  const r = createRuntime(state, {
    budget: 100000,
    beginScope: () => draw.scope(),
    endScope: () => draw.restore(),
    primitives: {
      ...draw.primitives(),
      'screen-width': () => width,
      'screen-height': () => height,
      'hit?': () => false,
      'focused?': () => false,
      'activated?': () => false,
      'pointer-pressed?': () => false,
      'pointer-down?': () => false,
      region: (id, label, origin, size) => regions.push({ id, label, origin, size }),
      surface: (p, s) => draw.surface(p, s),
      'buffer-open': () => {},
      'buffer-rows': () => [],
      'buffer-selections': () => [],
      'buffer-caret': () => null,
      status: () => 'Saved',
      'error?': () => false,
      'recovery?': () => false,
      waveform: () => {},
    },
  });
  r.load(parse(defaults.game));
  r.load(parse(uiSource));
  r.load(parse(editorSource));
  return { r, state, draw, regions };
}
test('fullscreen editor app draws pixels and defines its controls in Lisp', () => {
  const { r, draw, regions, state } = editor();
  r.call('editor');
  assert.deepEqual(draw.commands[0].bounds, [0, 0, 1440, 900]);
  assert.ok(draw.commands.some((c) => c.meta[0] === 4));
  assert.ok(draw.commands.some((c) => c.meta[0] === 3));
  assert.ok(regions.some((r) => r.id === 'tab-ui'));
  assert.equal(state['show-tools'], false);
  assert.equal(typeof r.global['ui-button'], 'function');
  assert.equal(typeof r.global['code-editor'], 'function');
});
test('Lisp changes editor background and widget appearance without changing the host', () => {
  const { r, draw, state } = editor();
  state['ui-bg'] = '#102030';
  r.call('editor');
  assert.deepEqual(draw.commands[0].color, [16 / 255, 32 / 255, 48 / 255, 1]);
  draw.commands.length = 0;
  r.load(
    parse(
      '(defn ui-button [id caption origin size active] (fill "#ff0000") (circle origin 8) false)',
    ),
  );
  r.call('editor');
  assert.ok(draw.commands.some((c) => c.meta[0] === 1 && c.color[0] === 1 && c.color[1] === 0));
});
test('drawing scopes restore settings while retaining rendered commands', () => {
  const d = new DrawList(100, 100);
  d.fill('#ffffff');
  d.scope();
  d.fill('#ff0000');
  d.primitives().translate([10, 5]);
  d.rect([0, 0], [5, 5]);
  d.restore();
  d.rect([0, 0], [5, 5]);
  assert.deepEqual(d.commands[0].bounds, [10, 5, 5, 5]);
  assert.deepEqual(d.commands[1].bounds, [0, 0, 5, 5]);
  assert.deepEqual(d.commands[1].color, [1, 1, 1, 1]);
});
test('spatial bins preserve painter order and omit clipped/offscreen primitives', () => {
  const d = new DrawList(64, 64);
  d.rect([0, 0], [64, 64]);
  d.rect([10, 10], [4, 4]);
  d.scope();
  d.clip([32, 0], [32, 64]);
  d.rect([0, 0], [8, 8]);
  d.restore();
  d.rect([-10, -10], [2, 2]);
  const { data } = binCommands(d.commands, 64, 64);
  const indices = Array.from(data.slice(data[0], data[0] + data[1]));
  assert.deepEqual(indices, [0, 1]);
  assert.equal(data[3], 1);
  assert.equal(data[5], 1);
  assert.equal(data[7], 1);
});
test('small viewports retain the fullscreen editor and code controls', () => {
  const { r, draw, regions } = editor(390, 844);
  r.call('editor');
  assert.deepEqual(draw.commands[0].bounds, [0, 0, 390, 844]);
  assert.ok(regions.find((r) => r.id === 'project').origin[0] < 100);
  assert.ok(regions.some((r) => r.id === 'tab-editor'));
});
