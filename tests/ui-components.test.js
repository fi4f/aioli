import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { layoutUI } from '../ui-layout.js';
import { dockLayout, DockInteraction } from '../ui-docking.js';
import { createRuntime, parse } from '../lisp.js';
import { DrawList } from '../drawing.js';

const label = (text, options = {}) => ({ type: 'label', label: text, options });
test('nested component layout measures text, padding, gaps and weighted flexible space', () => {
  const a = label('a'),
    b = label('b', { grow: 1 }),
    c = label('c', { grow: 2 });
  const root = {
    type: 'column',
    options: { padding: 10, gap: 4 },
    children: [
      label('title'),
      { type: 'row', options: { height: 30, gap: 6 }, children: [a, b, c] },
    ],
  };
  const entries = layoutUI(root, [5, 7], [200, 100]);
  assert.deepEqual(entries.find(([node]) => node === a).slice(1, 3), [
    [15, 39],
    [8, 30],
  ]);
  assert.equal(entries.find(([node]) => node === b)[2][0], 160 / 3);
  assert.equal(entries.find(([node]) => node === c)[2][0], 320 / 3);
  assert.throws(
    () => layoutUI({ type: 'row', options: { gap: -1 } }, [0, 0], [20, 20]),
    /nonnegative/,
  );
  assert.throws(
    () =>
      layoutUI(
        {
          type: 'row',
          children: [
            { type: 'button', id: 'same' },
            { type: 'button', id: 'same' },
          ],
        },
        [0, 0],
        [20, 20],
      ),
    /Duplicate/,
  );
});

test('scroll layout clips overflow, clamps stale offsets and filters conditional children', () => {
  const children = [null, false, ...Array.from({ length: 10 }, () => label('row'))];
  const root = { type: 'scroll', id: 'list', key: 'offset', options: { gap: 2 }, children };
  const entries = layoutUI(root, [0, 0], [100, 40], { offset: 999 });
  assert.equal(entries.length, 11);
  assert.deepEqual(entries.at(-1).slice(1, 3), [
    [0, 22],
    [84, 18],
  ]);
  assert.equal(entries[1][3][3], 0);
  const constrained = layoutUI({ ...root, options: { gap: 2, height: 40 } }, [0, 0], [100, 40], {
    offset: 999,
  });
  assert.deepEqual(constrained.at(-1)[1], [0, 22]);
});

test('Lisp components run actions once, respect disabled controls and rebuild without retained callbacks', () => {
  const draw = new DrawList(400, 200),
    regions = [],
    activated = new Set(['apply']);
  const state = {
    'ui-panel': '#272822',
    'ui-text': '#ffffff',
    'ui-accent': '#66d9ef',
    'ui-active-text': '#000000',
    'ui-hover': '#383a32',
    'ui-button': '#30312b',
    'ui-disabled': '#777777',
    count: 0,
  };
  const runtime = createRuntime(state, {
    budget: 100000,
    beginScope: () => draw.scope(),
    endScope: () => draw.restore(),
    primitives: {
      ...draw.primitives(),
      'ui-layout': layoutUI,
      'ui-region': (id, label, origin, size, enabled) => regions.push({ id, enabled }),
      'hit?': () => false,
      'focused?': () => false,
      'pointer-pressed?': () => false,
      'activated?': (id) => activated.has(id),
    },
  });
  runtime.load(parse(readFileSync(new URL('../editor/ui/layout.lisp', import.meta.url), 'utf8')));
  runtime.load(
    parse(`(defn view []
    (ui/render [0 0] [400 200]
      (ui/column (map) [(ui/with (map :disabled (get :disabled))
        (ui/button :apply "Apply" (fn [] (set! :count (+ (get :count) 1)))))])))`),
  );
  state.disabled = true;
  runtime.call('view');
  assert.equal(state.count, 0);
  assert.equal(regions[0].enabled, false);
  state.disabled = false;
  runtime.call('view');
  assert.equal(state.count, 1);
  activated.clear();
  runtime.call('view');
  assert.equal(state.count, 1);
});

test('dock layout reserves a center surface, persists edges and bounds floating panes on resize', () => {
  const panes = [
    { id: 'code', options: { dock: 'left', extent: 300 } },
    { id: 'game', options: { fixed: true } },
  ];
  const initial = dockLayout({}, panes, [0, 51], [1000, 700]);
  assert.deepEqual(initial[1].slice(1, 3), [
    [300, 51],
    [700, 700],
  ]);
  const right = dockLayout({ code: { dock: 'right', extent: 0.3 } }, panes, [0, 51], [1000, 700]);
  assert.deepEqual(right[0].slice(1, 3), [
    [700, 51],
    [300, 700],
  ]);
  const floating = dockLayout(
    { code: { dock: 'floating', x: 999, y: 999, width: 999, height: 999 } },
    panes,
    [0, 51],
    [500, 400],
  );
  assert.deepEqual(floating.at(-1).slice(1, 3), [
    [0, 51],
    [500, 400],
  ]);
});

test('docked and floating panes minimize to the bottom while preserving saved dimensions', () => {
  const panes = [
    { id: 'code', options: { dock: 'center' } },
    { id: 'game', options: { dock: 'center', collapsed: true } },
  ];
  const layout = dockLayout({}, panes, [0, 51], [1000, 700]);
  assert.deepEqual(layout.find(([pane]) => pane.id === 'game').slice(1, 3), [
    [0, 717],
    [168, 34],
  ]);
  assert.deepEqual(layout.find(([pane]) => pane.id === 'code').slice(1, 3), [
    [0, 51],
    [1000, 666],
  ]);
  const placements = { game: { dock: 'floating', x: 20, y: 100, width: 300, height: 400 } };
  const collapsed = dockLayout(placements, panes, [0, 51], [1000, 700]);
  assert.equal(collapsed.at(-1)[2][1], 34);
  assert.equal(collapsed.at(-1)[1][1], 717);
  assert.equal(collapsed.at(-1)[5], true);
  assert.deepEqual(placements.game, { dock: 'floating', x: 20, y: 100, width: 300, height: 400 });
  panes[1].options.collapsed = false;
  assert.equal(dockLayout(placements, panes, [0, 51], [1000, 700]).at(-1)[2][1], 400);
});

test('dock dragging floats, snaps only at workspace edges and restores canceled placement', () => {
  let now = 0;
  const state = { docks: {} },
    control = new DockInteraction({ now: () => now });
  const region = {
    dockPane: 'code',
    dockKey: 'docks',
    dockDefault: 'left',
    dockKind: 'move',
    dockRect: [0, 51, 300, 700],
    dockWorkspace: [0, 51, 1000, 700],
  };
  control.begin(state, region, 20, 60);
  control.move(220, 260);
  assert.equal(state.docks.code.dock, 'floating');
  assert.equal(control.preview, null);
  control.move(990, 260);
  assert.equal(control.preview.edge, 'right');
  now += 700;
  control.end();
  assert.deepEqual({ ...state.docks.code }, { dock: 'right', extent: 0.3 });
  const saved = structuredClone(state.docks);
  control.begin(state, region, 20, 60);
  control.move(400, 200);
  control.end(true);
  assert.deepEqual(state.docks, saved);
});
