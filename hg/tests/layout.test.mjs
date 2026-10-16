import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Data } from '../data.js';
import { Layout } from '../layout.js';

test('padding keeps independent vectors, float conversion, and invalid-input checks', () => {
  const source = Data.vector(2, [3, 4]);
  const pad = Layout.padding(source);
  assert.deepEqual(Data.values(pad), [3, 4]);
  Data.put(pad, 0, 9);
  assert.deepEqual(Data.values(source), [3, 4]);
  assert.deepEqual(Data.values(Layout.padding(0.1)), [Math.fround(0.1), Math.fround(0.1)]);
  assert.deepEqual(Data.values(Layout.padding(Number.MAX_VALUE)), [2 ** 128 - 2 ** 104, 2 ** 128 - 2 ** 104]);
  for (const value of [-1, NaN, Infinity, null, '4', Data.vector(2, [1, -1]), Data.vector(3, [1])])
    assert.throws(() => Layout.padding(value), TypeError);
});

test('rectangle insets round padding before geometry and leave their inputs unchanged', () => {
  const bounds = Data.vector(4, [1, 2, 10, 20]);
  const pad = Math.fround(0.1);
  assert.deepEqual(Data.values(Layout.inset(bounds, 0.1)),
    [1 + pad, 2 + pad, 10 - 2 * pad, 20 - 2 * pad].map(Math.fround));
  assert.deepEqual(Data.values(Layout.inset(bounds, 20)), [21, 22, 0, 0]);
  assert.deepEqual(Data.values(bounds), [1, 2, 10, 20]);
  assert.throws(() => Layout.inset(Data.vector(2, [1, 2]), 0), TypeError);
  assert.throws(() => Layout.inset(bounds, -1), TypeError);
});
