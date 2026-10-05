import test from 'node:test';
import assert from 'node:assert/strict';
import { monochromeMask } from '../icon-mask.js';
test('icon masks remove white backgrounds and preserve black coverage, alpha, and gray edges', () => {
  const source = new Uint8ClampedArray([
    0, 0, 0, 255, 255, 255, 255, 255, 128, 128, 128, 255, 0, 0, 0, 128, 0, 0, 0, 0,
  ]);
  assert.deepEqual(
    [...monochromeMask(source)],
    [
      255, 255, 255, 255, 255, 255, 255, 0, 255, 255, 255, 127, 255, 255, 255, 128, 255, 255, 255,
      0,
    ],
  );
  assert.equal(source[0], 0);
});
