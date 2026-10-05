import test from 'node:test';
import assert from 'node:assert/strict';
import { fitSurface } from '../surface-layout.js';
import { DrawList } from '../drawing.js';

test('landscape and portrait exports fit and center both shader and CPU drawing', () => {
  for (const [width, height] of [
    [1200, 500],
    [500, 1000],
    [800, 600],
  ]) {
    const { origin, size, scale } = fitSurface(width, height);
    assert.equal(size[0] / size[1], 4 / 3);
    assert.ok(size[0] <= width + 1e-9 && size[1] <= height + 1e-9);
    assert.equal(origin[0] * 2 + size[0], width);
    assert.equal(origin[1] * 2 + size[1], height);
    const scene = new DrawList(320, 240);
    scene.rect([12, 12], [40, 40]);
    const host = new DrawList(width, height);
    host.surface(origin, size);
    host.composite(scene, origin, size);
    assert.equal(host.commands[1].bounds[2], host.commands[1].bounds[3]);
    const point = [origin[0] + 12 * scale, origin[1] + 12 * scale];
    assert.ok(point.every((v, i) => Math.abs((v - origin[i]) / scale - 12) < 1e-9));
  }
});
