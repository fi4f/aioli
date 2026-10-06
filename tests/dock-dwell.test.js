import test from 'node:test';
import assert from 'node:assert/strict';
import { DockInteraction } from '../ui-docking.js';

function fixture() {
  let time = 0;
  const control = new DockInteraction({ now: () => time });
  const state = { docks: { code: { dock: 'floating', x: 100, y: 100, width: 300, height: 300 } } };
  const region = {
    dockPane: 'code',
    dockKey: 'docks',
    dockDefault: 'left',
    dockKind: 'move',
    dockRect: [100, 100, 300, 300],
    dockWorkspace: [0, 0, 1200, 900],
  };
  control.begin(state, region, 120, 110);
  return {
    control,
    state,
    advance: (ms) => {
      time += ms;
      control.tick();
    },
  };
}
test('quick floating repositioning stays floating even when released over a dock target', () => {
  const { control, state, advance } = fixture();
  control.move(1190, 300);
  advance(300);
  assert.ok(control.preview.progress > 0 && control.preview.progress < 1);
  assert.equal(control.preview.ready, false);
  control.end();
  assert.equal(state.docks.code.dock, 'floating');
});
test('stationary dwell arms docking without requiring another pointer event', () => {
  const { control, state, advance } = fixture();
  control.move(1190, 300);
  advance(699);
  assert.equal(control.preview.ready, false);
  advance(1);
  assert.equal(control.preview.progress, 1);
  control.end();
  assert.equal(state.docks.code.dock, 'right');
});
test('movement, target changes, and leaving a target restart the docking countdown', () => {
  const { control, state, advance } = fixture();
  control.move(1190, 300);
  advance(600);
  control.move(1190, 320);
  assert.equal(control.preview.progress, 0);
  advance(700);
  assert.equal(control.preview.ready, true);
  control.move(10, 320);
  assert.equal(control.preview.ready, false);
  advance(300);
  control.move(600, 450);
  assert.equal(control.preview, null);
  control.move(10, 320);
  assert.equal(control.preview.progress, 0);
  advance(600);
  control.end();
  assert.equal(state.docks.code.dock, 'floating');
});
test('small pointer jitter preserves progress and Escape cancels an armed target', () => {
  const { control, state, advance } = fixture();
  const saved = structuredClone(state.docks);
  control.move(1190, 300);
  advance(400);
  control.move(1188, 302);
  assert.ok(control.preview.progress > 0.5);
  advance(300);
  assert.equal(control.preview.ready, true);
  control.end(true);
  assert.deepEqual(state.docks, saved);
});
