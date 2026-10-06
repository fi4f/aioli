import test from 'node:test';
import assert from 'node:assert/strict';
import { dockLayout, DockInteraction } from '../ui-docking.js';
import { splitLeaf, leaves, removeLeaf } from '../ui-dock-tree.js';

const panes = [
  { id: 'files', options: { dock: 'left', extent: 280 } },
  { id: 'code', options: { dock: 'left', extent: 0.42 } },
  { id: 'game', options: { dock: 'center' } },
];
function observe(control, placements, list = panes) {
  const entries = dockLayout(placements, list, [0, 51], [1200, 819]);
  control.observe('docks', placements, list, [0, 51], [1200, 819], entries);
  return entries;
}

test('detaching shrinks both dimensions, insets resize edges, and later floating moves keep the size', () => {
  const control = new DockInteraction();
  const state = { docks: {} };
  const region = {
    dockKey: 'docks',
    dockPane: 'game',
    dockDefault: 'center',
    dockKind: 'move',
    dockRect: [0, 51, 1000, 700],
    dockWorkspace: [0, 51, 1000, 700],
  };
  control.begin(state, region, 20, 61);
  control.move(500, 740);
  control.end();
  const floating = state.docks.game;
  assert.equal(floating.dock, 'floating');
  assert.equal(floating.width, 900);
  assert.equal(floating.height, 630);
  assert.ok(floating.x >= 16 && floating.x + floating.width <= 984);
  assert.ok(floating.y >= 67 && floating.y + floating.height <= 735);
  control.begin(
    state,
    { ...region, dockRect: [floating.x, floating.y, floating.width, floating.height] },
    floating.x + 20,
    floating.y + 10,
  );
  control.move(400, 300);
  control.end();
  assert.equal(state.docks.game.width, 900);
  assert.equal(state.docks.game.height, 630);
});

test('floating panes without a saved position spawn at the workspace center', () => {
  const entries = dockLayout(
    {},
    [{ id: 'tool', options: { dock: 'floating' } }],
    [0, 51],
    [1200, 819],
  );
  assert.deepEqual(entries[0].slice(1, 3), [
    [390, 300.5],
    [420, 320],
  ]);
});

test('minimizing nested panes frees their splits, wraps bottom tabs and restores exact geometry', () => {
  const placements = {
    _tree: {
      axis: 'x',
      ratio: 0.3,
      first: 'files',
      second: {
        axis: 'y',
        ratio: 0.6,
        first: 'game',
        second: 'code',
      },
    },
  };
  const original = structuredClone(placements);
  const list = structuredClone(panes);
  const before = dockLayout(placements, list, [0, 51], [1200, 819]);
  list[0].options.collapsed = true;
  list[1].options.collapsed = true;
  const control = new DockInteraction();
  const minimized = observe(control, placements, list);
  assert.deepEqual(minimized.find(([p]) => p.id === 'game').slice(1, 3), [
    [0, 51],
    [1200, 785],
  ]);
  for (const id of ['files', 'code']) {
    const tab = minimized.find(([p]) => p.id === id);
    assert.equal(tab[5], true);
    assert.equal(tab[1][1], 836);
    assert.equal(
      control.resizeRegions('docks').some((r) => r.dockPane === id),
      false,
    );
  }
  assert.deepEqual(placements, original);
  const narrow = dockLayout(placements, list, [0, 51], [180, 819]);
  assert.equal(narrow.find(([p]) => p.id === 'files')[1][1], 802);
  assert.equal(narrow.find(([p]) => p.id === 'code')[1][1], 836);
  list[0].options.collapsed = false;
  list[1].options.collapsed = false;
  const restored = dockLayout(JSON.parse(JSON.stringify(placements)), list, [0, 51], [1200, 819]);
  assert.deepEqual(
    restored.map((e) => e.slice(0, 5)),
    before.map((e) => e.slice(0, 5)),
  );
  list[0].options.collapsed = true;
  list[0].visible = false;
  assert.equal(
    dockLayout(placements, list, [0, 51], [1200, 819]).some(([p]) => p.id === 'files'),
    false,
  );
});
test('clicking floating content raises its pane and persists a stable stacking order', () => {
  const control = new DockInteraction(),
    state = {
      docks: {
        code: { dock: 'floating', z: 1 },
        game: { dock: 'floating', z: 2 },
      },
    };
  observe(control, state.docks);
  assert.equal(control.promote(state, { dockKey: 'docks', dockOwner: 'code' }), true);
  assert.equal(observe(control, state.docks).at(-1)[0].id, 'code');
  assert.equal(control.promote(state, { dockKey: 'docks', dockOwner: 'code' }), false);
  assert.equal(control.promote(state, { dockKey: 'docks', dockOwner: 'game' }), true);
  assert.equal(observe(control, JSON.parse(JSON.stringify(state.docks))).at(-1)[0].id, 'game');
});
test('floating left and top edges retain the opposite edge, and cancellation restores dimensions', () => {
  for (const edge of ['left', 'right', 'top', 'bottom']) {
    const control = new DockInteraction(),
      state = { docks: { code: { dock: 'floating', x: 300, y: 200, width: 400, height: 300 } } };
    observe(control, state.docks);
    const region = control
      .resizeRegions('docks')
      .find((r) => r.dockPane === 'code' && r.dockKind === `resize-${edge}`);
    const saved = structuredClone(state.docks);
    control.begin(state, region, 400, 300);
    control.move(420, 320);
    const rect = state.docks.code;
    if (edge === 'left') {
      assert.equal(rect.x, 320);
      assert.equal(rect.x + rect.width, 700);
    }
    if (edge === 'top') {
      assert.equal(rect.y, 220);
      assert.equal(rect.y + rect.height, 500);
    }
    if (edge === 'right') assert.equal(rect.width, 420);
    if (edge === 'bottom') assert.equal(rect.height, 320);
    control.end(true);
    assert.deepEqual(state.docks, saved);
  }
});
test('all four pane-relative docking sides create exact complementary halves', () => {
  const targetPanes = [panes[0], panes[1]];
  for (const edge of ['left', 'right', 'top', 'bottom']) {
    const placements = { _tree: splitLeaf('files', 'files', 'code', edge) };
    const entries = dockLayout(placements, targetPanes, [0, 0], [800, 600]);
    const a = entries.find(([p]) => p.id === 'files'),
      b = entries.find(([p]) => p.id === 'code');
    if (edge === 'left' || edge === 'right') {
      assert.equal(a[2][0], 400);
      assert.equal(b[2][0], 400);
      assert.equal(a[2][1], 600);
      assert.equal(b[1][0], edge === 'left' ? 0 : 400);
    } else {
      assert.equal(a[2][1], 300);
      assert.equal(b[2][1], 300);
      assert.equal(a[2][0], 800);
      assert.equal(b[1][1], edge === 'top' ? 0 : 300);
    }
    assert.deepEqual(new Set(leaves(placements._tree)), new Set(['files', 'code']));
  }
});
test('pane split preview matches committed geometry and dividers resize both neighbors', () => {
  let now = 0;
  const state = { docks: {} },
    control = new DockInteraction({ now: () => now });
  const initial = observe(control, state.docks),
    code = initial.find(([p]) => p.id === 'code');
  const region = {
    dockPane: 'code',
    dockKey: 'docks',
    dockDefault: 'left',
    dockKind: 'move',
    dockRect: [...code[1], ...code[2]],
    dockWorkspace: [0, 51, 1200, 819],
  };
  control.begin(state, region, 300, 60);
  control.move(140, 720);
  observe(control, state.docks);
  control.move(140, 720);
  assert.equal(control.preview.target, 'files');
  assert.equal(control.preview.edge, 'bottom');
  const preview = control.preview.rect;
  now += 700;
  control.end();
  const arranged = observe(control, state.docks),
    actual = arranged.find(([p]) => p.id === 'code');
  assert.deepEqual([...actual[1], ...actual[2]], preview);
  const divider = control
    .resizeRegions('docks')
    .find((r) => r.dockKind === 'divider' && r.divider.axis === 'y');
  control.begin(state, divider, 140, divider.origin[1] + 3);
  control.move(140, divider.origin[1] + 63);
  control.end();
  const resized = observe(control, state.docks),
    top = resized.find(([p]) => p.id === 'files'),
    bottom = resized.find(([p]) => p.id === 'code');
  assert.equal(top[2][1] + bottom[2][1], 819);
  assert.equal(bottom[1][1], top[1][1] + top[2][1]);
  assert.ok(top[2][1] > 409.5);
  const saved = structuredClone(state.docks);
  const cancelDivider = control
    .resizeRegions('docks')
    .find((r) => r.dockKind === 'divider' && r.divider.axis === 'y');
  control.begin(state, cancelDivider, 140, cancelDivider.origin[1] + 3);
  control.move(140, cancelDivider.origin[1] + 43);
  control.end(true);
  assert.deepEqual(state.docks, saved);
});
test('nested splits survive hiding and reload, and removing leaves does not leave empty splits', () => {
  const tree = splitLeaf(splitLeaf('files', 'files', 'code', 'bottom'), 'code', 'game', 'left');
  const state = { _tree: tree };
  const entries = dockLayout(state, panes, [0, 51], [1200, 819]);
  const hidden = panes.map((p) => ({ ...p, visible: p.id !== 'files' }));
  const without = dockLayout(state, hidden, [0, 51], [1200, 819]);
  assert.equal(without.find(([p]) => p.id === 'code')[2][1], 819);
  assert.deepEqual(
    structuredClone(dockLayout(JSON.parse(JSON.stringify(state)), panes, [0, 51], [1200, 819])),
    structuredClone(entries),
  );
  assert.deepEqual(leaves(removeLeaf(tree, 'game')), ['files', 'code']);
});
