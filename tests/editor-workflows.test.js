import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRuntime, parse } from '../lisp.js';
import { policy, policyPaths } from '../editor-policy.js';
import { tabLayout } from '../code-tabs.js';
import { planFileMove } from '../file-moves.js';
import { DockInteraction } from '../ui-docking.js';

test('file workflows choose views and retain source tabs across narrow layouts', () => {
  const sources = { main: '', game: '', 'tool.generator.lisp': '', 'level.scene.lisp': '' };
  const state = { tab: 'game', 'open-tabs': ['main', 'game'], 'show-files': true };
  const opened = policy('editor-file-open', [state, sources, {}, 'level.scene.lisp', 390]);
  assert.equal(opened.action, 'code');
  assert.equal(opened.state['show-files'], false);
  assert.deepEqual(opened.state['open-tabs'], ['main', 'game', 'level.scene.lisp']);
  assert.equal(state.tab, 'game');
  assert.equal(
    policy('editor-file-open', [state, sources, {}, 'tool.generator.lisp', 1200]).action,
    'generator',
  );
  const asset = policy('editor-file-open', [state, sources, { 'a.png': {} }, 'a.png', 1200]);
  assert.equal(asset.action, 'asset');
  assert.equal(asset.state['selected-file'], 'a.png');
  assert.throws(
    () => policy('editor-file-open', [state, sources, {}, 'missing.lisp', 1200]),
    /Missing file/,
  );
});

test('shortcut priorities preserve menu navigation, command execution and game input isolation', () => {
  const shortcut = (state, key, options = {}, focus = 'code', dragging = false) =>
    policy('editor-shortcut', [state, { key, ...options }, focus, dragging]);
  assert.equal(shortcut({}, 'Escape', {}, 'world', true).action, 'cancel-drag');
  assert.equal(shortcut({ 'preview-focused': true }, 'Escape').action, 'preview');
  assert.equal(shortcut({ menu: 'file' }, 'Escape').action, 'focus');
  assert.equal(shortcut({ menu: 'file' }, 'ArrowLeft').state.menu, 'about');
  assert.equal(shortcut({ menu: 'about' }, 'ArrowRight').state.menu, 'file');
  assert.equal(shortcut({ window: 'palette' }, 'Enter', { command: true }).action, 'instruction');
  assert.equal(shortcut({}, 'Enter', { command: true }).action, 'evaluate');
  assert.equal(shortcut({}, 'S', { command: true }).action, 'export');
  assert.equal(shortcut({}, 'A', {}, 'world').key, 'a');
  assert.equal(shortcut({}, 'a'), null);
  assert.equal(shortcut({}, 'a', { alt: true }, 'world').action, 'focus');
  assert.equal(policy('editor-menu-focus-index', [-1, 3, -1]), 2);
  assert.equal(policy('editor-menu-focus-index', [0, 0, 1]), -1);
});

test('inspector edit plans serialize structured data without mutating live state', () => {
  const state = { player: { x: 4 }, color: '#ffffff' };
  const fields = [
    { key: 'player', kind: 'data' },
    { key: 'color', kind: 'color' },
  ];
  const plan = policy('editor-field-edit', [fields, state, 'player', 'scene']);
  assert.equal(plan.buffer, '{"x":4}');
  assert.equal(plan.state['scene-edit-key'], 'player');
  assert.equal(plan.color, false);
  assert.equal(policy('editor-field-edit', [fields, state, 'color', 'generator']).color, true);
  assert.equal(state['scene-edit-key'], undefined);
  assert.throws(
    () => policy('editor-field-edit', [fields, state, 'missing', 'scene']),
    /Unknown scene field/,
  );
});

test('tab fitting reaches the final source at the project limit and bounds wide layouts', () => {
  const sources = Object.fromEntries(
    Array.from({ length: 256 }, (_, i) => [`file${i}.lisp`, '; source']),
  );
  const state = { tab: 'file255.lisp', 'open-tabs': Object.keys(sources) };
  const result = tabLayout(state, sources, sources, 500);
  assert.equal(result.rows.at(-1)[0], 'file255.lisp');
  const wide = tabLayout(
    { tab: 'file0.lisp', 'open-tabs': Object.keys(sources) },
    sources,
    sources,
    100000,
  );
  assert.equal(wide.rows.length, 64);
  assert.equal(wide.after, true);
});

test('folder remapping and backup planning preserve data and keep edits atomic', () => {
  const state = { scene: 'old/level.scene.lisp', list: ['old/a.png', 'other/a.png'], score: 3 };
  const remapped = policy('editor-remap-state', [state, 'old', 'new', true]);
  assert.equal(remapped.scene, 'new/level.scene.lisp');
  assert.deepEqual(remapped.list, ['new/a.png', 'other/a.png']);
  assert.equal(state.scene, 'old/level.scene.lisp');
  const sources = { main: '; custom', 'main-backup-1.lisp': '; existing', game: '; game' };
  const plan = policy('editor-upgrade-plan', [sources, {}, { main: '; default' }, ['main'], []]);
  assert.equal(plan.sources.main, '; default');
  assert.equal(plan.sources['main-backup-2.lisp'], '; custom');
  assert.deepEqual(plan.owned, ['main-backup-2.lisp']);
  assert.equal(sources.main, '; custom');
});

test('live Lisp edits control file protection and dock geometry through native adapters', () => {
  const editor = createRuntime({});
  for (const path of policyPaths)
    editor.load(parse(readFileSync(new URL('../' + path, import.meta.url), 'utf8')), path);
  editor.load(
    parse('(defn editor-file-move-check [sources resources old new] (error "custom move rule"))'),
  );
  assert.throws(
    () => planFileMove({ 'a.lisp': '' }, {}, 'a.lisp', 'b.lisp', editor),
    /custom move rule/,
  );
  editor.load(
    parse(
      '(defn dock-floating [before region start point placements] (map :dock "floating" :x 77 :y 88 :width 120 :height 80))',
    ),
  );
  const control = new DockInteraction({ editor: () => editor });
  const state = { docks: {} };
  control.begin(
    state,
    {
      dockKey: 'docks',
      dockPane: 'pane',
      dockDefault: 'center',
      dockKind: 'move',
      dockRect: [0, 0, 300, 200],
      dockWorkspace: [0, 0, 500, 400],
    },
    10,
    10,
  );
  control.move(100, 100);
  assert.equal(state.docks.pane.x, 77);
  assert.equal(state.docks.pane.y, 88);
  control.end(true);
  assert.deepEqual(state.docks, {});
});

test('map removal/merge are persistent and numeric input rejects empty or nonfinite values', () => {
  const runtime = createRuntime({});
  runtime.load(
    parse(
      '(init! :original (map :a 1 :b 2)) (init! :next (merge (dissoc (get :original) :a) (map :c 3)))',
    ),
  );
  assert.equal(runtime.state.original.a, 1);
  assert.equal(runtime.state.next.a, undefined);
  assert.equal(runtime.state.next.c, 3);
  assert.equal(runtime.evaluate(parse('(parse-number " 42 ")')[0]), 42);
  for (const value of ['', 'Infinity', 'NaN'])
    assert.throws(() => runtime.evaluate(parse(`(parse-number "${value}")`)[0]), /finite number/);
});

test('cond evaluates only the first matching branch and rejects malformed pairs', () => {
  const runtime = createRuntime({ count: 0 });
  runtime.load(
    parse(
      '(defn choose [] (cond false (set! :count 99) true (set! :count 1) true (set! :count 2)))',
    ),
  );
  assert.equal(runtime.call('choose'), 1);
  assert.equal(runtime.state.count, 1);
  assert.equal(runtime.evaluate(parse('(cond false 1)')[0]), null);
  assert.throws(() => runtime.evaluate(parse('(cond true)')[0]), /condition\/expression pairs/);
});

test('tab layout caching observes source edits, workspace changes and redefined Lisp helpers', () => {
  const editor = createRuntime({});
  for (const path of policyPaths)
    editor.load(parse(readFileSync(new URL('../' + path, import.meta.url), 'utf8')), path);
  const sources = { game: '; original' },
    committed = { ...sources };
  const state = { tab: 'game' };
  const initial = tabLayout(state, sources, committed, 500, editor);
  assert.equal(tabLayout(state, sources, committed, 500, editor), initial);
  sources.game = '; edited';
  assert.equal(tabLayout(state, sources, committed, 500, editor).rows[0][4], true);
  editor.load(parse('(defn editor-tab-label [key] "Custom")'));
  assert.equal(tabLayout(state, sources, committed, 500, editor).rows[0][1], 'Custom');
  state['tab-offset'] = 1;
  assert.equal(tabLayout(state, sources, committed, 500, editor).state['tab-offset'], 0);
});
