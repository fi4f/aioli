import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, createRuntime } from '../lisp.js';
import { DrawList, binCommands } from '../drawing.js';
import { resolveModules, cpuForms } from '../project.js';
import { editorSourcePaths } from '../editor-sources.js';
import { tabLayout } from '../code-tabs.js';
import { generatorSources } from '../generators.js';
import { defaults } from '../examples.js';
const uiSource = readFileSync(
  new URL('../editor/ui/components.lisp', import.meta.url),
  'utf8',
).replaceAll('\"./', '\"./editor/ui/');
const editorSource = readFileSync(new URL('../main.lisp', import.meta.url), 'utf8');
const sources = {
  ...defaults,
  ...generatorSources,
  ui: uiSource,
  main: editorSource,
  ...Object.fromEntries(
    editorSourcePaths.map((path) => [
      path,
      readFileSync(new URL('../' + path, import.meta.url), 'utf8'),
    ]),
  ),
};

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
      'game-get': (key) =>
        state[key] ??
        {
          moon: 18,
          wind: 3,
          glow: 0.4,
          speed: 80,
          accent: '#c4ef9b',
          wave: 'sine',
          pitch: 440,
          'end-pitch': 220,
          duration: 0.3,
          volume: 0.2,
          overtone: false,
        }[key],
      'game-set!': (key, value) => (state[key] = value),
      'preview-path': () => 'game.lisp',
      'scene-fields': () => [],
      'source-hooks': () => [],
      'scroll-region': (id, origin, size, key, limit) =>
        Math.max(0, Math.min(limit, state[key] ?? 0)),
      'screen-width': () => width,
      'screen-height': () => height,
      'icon-available?': () => false,
      'file-drag-path': () => '',
      'file-drop-target?': () => false,
      'save-file?': () => true,
      'hit?': () => false,
      'focused?': () => false,
      'activated?': () => false,
      'pointer-pressed?': () => false,
      'pointer-moved?': () => false,
      'pointer-down?': () => false,
      region: (id, label, origin, size) => regions.push({ id, label, origin, size }),
      surface: (p, s) => draw.surface(p, s),
      'buffer-open': () => {},
      'code-tabs': (width) => tabLayout(state, sources, sources, width).rows,
      'code-tabs-before?': () => false,
      'code-tabs-after?': () => false,
      'active-code-path': () => state.tab + '.lisp',
      'buffer-rows': () => [],
      'buffer-hooks': () => [],
      'buffer-selections': () => [],
      'buffer-caret': () => null,
      status: () => 'Saved',
      'error?': () => false,
      'recovery?': () => false,
      'project-tree': () => [],
      'project-tree-width': () => 0,
      'project-tree-count': () => 0,
      'project-tree-offset': () => 0,
      'path-input': () => 'lib/new.lisp',
      'can-edit-buffer?': () => false,
      'selected-file?': () => true,
      'selected-file-renamable?': () => true,
      'selected-file-removable?': () => false,
      'menu-region': (id, label, origin, size, enabled, checked) =>
        regions.push({ id, label, origin, size, disabled: !enabled, checked }),
      waveform: () => {},
    },
  });
  r.load(cpuForms(parse(defaults['scenes/garden.scene.lisp'])));
  resolveModules(sources, ['ui', 'main']).forEach((module) => r.load(cpuForms(module.forms)));
  return { r, state, draw, regions };
}
test('fullscreen editor app draws pixels and defines its controls in Lisp', () => {
  const { r, draw, regions, state } = editor();
  r.call('editor');
  assert.deepEqual(draw.commands[0].bounds, [0, 0, 1440, 900]);
  assert.ok(draw.commands.some((c) => c.meta[0] === 4));
  assert.ok(draw.commands.some((c) => c.meta[0] === 3));
  assert.ok(regions.some((r) => r.id === 'tab-main'));
  assert.equal(state['show-tools'], false);
  assert.equal(typeof r.global['ui-button'], 'function');
  assert.equal(typeof r.global['code-editor'], 'function');
});
test('file pane and code pane share the screen without overlapping input', () => {
  const { r, state, regions } = editor();
  state['show-files'] = true;
  r.call('editor');
  const tree = regions.find((region) => region.id === 'files-tree');
  const scene = regions.find((region) => region.id === 'tab-main');
  assert.ok(tree);
  assert.ok(scene.origin[0] >= tree.origin[0] + tree.size[0]);
  assert.equal(
    regions.some((region) => region.id === 'window'),
    false,
  );
});
test('menu bar has exactly the requested domains, with disabled editing actions', () => {
  const { r, state, regions } = editor();
  r.call('editor');
  assert.deepEqual(
    regions.filter((region) => region.origin[1] === 8).map((region) => region.label),
    ['File', 'Project', 'View', 'Edit', 'About'],
  );
  regions.length = 0;
  state.menu = 'edit';
  r.call('editor');
  assert.equal(regions.find((region) => region.id === 'undo').disabled, true);
  assert.equal(regions.find((region) => region.id === 'cut').disabled, true);
  assert.equal(
    regions.some((region) => region.id === 'menu-dismiss'),
    true,
  );
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
  assert.ok(regions.some((r) => r.id === 'tab-main'));
});
