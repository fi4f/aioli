import test from 'node:test';
import assert from 'node:assert/strict';
import { displayMetrics, deviceCommands } from '../gpu.js';
import { DrawList, binCommands } from '../drawing.js';

test('fractional density scales rendering without mutating Lisp layout', () => {
  for (const density of [1, 1.25, 1.5, 1.75, 2]) {
    const metrics = displayMetrics(800, 600, density);
    assert.equal(metrics.width, 800 * density);
    assert.equal(metrics.height, 600 * density);
    const draw = new DrawList(800, 600);
    draw.text([20, 30], 'AB');
    draw.line([10, 20], [30, 40], 2);
    const before = structuredClone(draw.commands);
    const commands = deviceCommands(draw.commands, metrics);
    assert.deepEqual(draw.commands, before);
    assert.deepEqual(
      commands[0].bounds,
      [20, 30, 8, 18].map((v) => v * density),
    );
    assert.equal(commands[1].detail[0] - commands[0].detail[0], metrics.glyphWidth);
    assert.deepEqual(commands[0].detail.slice(2), [8 * density, 18 * density]);
    assert.deepEqual(
      commands[2].detail,
      [10, 20, 30, 40].map((v) => v * density),
    );
    assert.equal(commands[2].meta[1], 2 * density);
    assert.deepEqual(commands[0].clip, [0, 0, metrics.width, metrics.height]);
    assert.equal(
      binCommands(commands, metrics.width, metrics.height).columns,
      Math.ceil(metrics.width / 32),
    );
  }
});

test('display dimensions round to physical pixels and respect GPU limits', () => {
  assert.equal(displayMetrics(803, 601, 1.25).width, 1004);
  assert.equal(displayMetrics(803, 601, 1.25).height, 751);
  assert.equal(displayMetrics(800, 600, NaN).density, 1);
  assert.equal(displayMetrics(800, 600, 0).density, 1);
  const capped = displayMetrics(800, 600, 2, 1000);
  assert.equal(capped.width, 1000);
  assert.equal(capped.height, 750);
});
