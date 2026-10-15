import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Preview } from '../preview.js';
import { Data } from '../data.js';
import { Types } from '../types.js';
import { Structures } from '../structures.js';
import { Compiler } from '../compiler.js';
import { Bindings } from '../bindings.js';
import { Forms } from '../forms.js';
import { App, AppCore } from '../app.js';

test('previews preserve falsy values, bound strings, and distinguish cycles from shared children', () => {
  const child = { zero: 0, flag: false, empty: '', nil: null };
  const root = { child, alias: child, items: [child] }; root.self = root;
  assert.deepEqual(Preview.describe(root).keys, ['child', 'alias', 'items', 'self']);
  for (const [key, expected] of [['zero', '0'], ['flag', 'false'], ['empty', '""'], ['nil', 'nil']])
    assert.equal(Preview.describe(root, ['child', key]).preview, expected);
  assert.equal(Preview.describe(root, ['alias']).circular, false);
  assert.equal(Preview.describe(root, ['items', 0]).circular, false);
  assert.equal(Preview.describe(root, ['self']).circular, true);
  assert.deepEqual(Preview.describe(root, ['self']).keys, []);
  assert.match(Preview.describe('a\n' + 'x'.repeat(1000)).preview, /^"a\\n/);
  assert.ok(Preview.describe('x'.repeat(1000)).preview.length < 170);
});

test('previews avoid getters, executable calls, and eager reads of lazy lists and namespaces', () => {
  let reads = 0;
  const root = { run: () => { throw new Error('Must not call'); } };
  Object.defineProperty(root, 'getter', { enumerable: true, get() { reads++; throw new Error('Must not read'); } });
  assert.deepEqual(Preview.describe(root).keys, ['run', 'getter']);
  assert.equal(Preview.describe(root, ['run']).preview, 'function');
  assert.match(Preview.describe(root, ['getter']).preview, /Accessor is not evaluated/);
  const guardedList = [0];
  Object.defineProperty(guardedList, 0, { get() { reads++; return 1; } });
  assert.match(Preview.describe(guardedList, [0]).preview, /Accessor is not evaluated/);
  const list = Data.lazyList(100000, index => { reads++; return index; });
  assert.deepEqual(Preview.describe(list, [], 3, 99990).keys, [99990, 99991, 99992]);
  const namespace = {};
  Data.registerBindingCells(namespace, { list: { value: list } });
  assert.deepEqual(Preview.describe(namespace).keys, ['list']);
  assert.equal(reads, 0);
  assert.equal(Preview.describe(namespace, ['list', 99991]).preview, '99991');
  assert.equal(reads, 1);
  const cell = {};
  Object.defineProperty(cell, 'value', { get() { reads++; return 1; } });
  Data.registerBindingCells(namespace, { guarded: cell });
  assert.match(Preview.describe(namespace, ['guarded']).preview, /Accessor is not evaluated/);
  assert.equal(reads, 1);
  assert.equal(Preview.describe(new Map()).type, '__opaque__');
});

test('previews enumerate typed fields and components through ordinary access rules', () => {
  const Point = Structures.createStruct('Point', [['x', 'f32'], ['enabled', 'bool']]);
  const point = Point('x', 3, 'enabled', true);
  assert.deepEqual(Preview.describe(point).keys, ['x', 'enabled']);
  assert.equal(Preview.describe(point, ['x']).preview, '3');
  const vector = Data.vector(3, [2, 4, 6]);
  assert.deepEqual(Preview.describe(vector).keys, ['x', 'y', 'z']);
  assert.equal(Preview.describe(vector, ['y']).preview, '4');
  assert.equal(Preview.describe(vector, [1]).preview, '4');
  const matrix = Data.matrix(2, [1, 2, 3, 4]);
  assert.deepEqual(Preview.describe(matrix).keys, [0, 1]);
  assert.equal(Preview.describe(matrix, [1, 0]).preview, '3');
  for (const source of ['(array (f32) 1 2 3)', '(many (f32 10) 1 2 3)']) {
    const value = Compiler.run(Compiler.compile(source, Bindings, Forms));
    assert.equal(Preview.describe(value).count, 3);
    assert.deepEqual(Preview.describe(value, [], 2, 1).keys, [1, 2]);
    assert.equal(Preview.describe(value, [2]).preview, '3');
  }
  const host = Data.registerHostData({ state: { count: 8 }, internal: new Set() });
  assert.deepEqual(Preview.describe(host).keys, ['state', 'internal']);
  assert.equal(Preview.describe(host, ['state', 'count']).preview, '8');
  assert.equal(Preview.describe(host, ['internal']).preview, 'opaque');
  assert.equal(Preview.describe(Types.textureHandle(8, 4), ['w']).preview, '8');
  assert.equal(Preview.describe(Types.bindingHandle('sample'), ['name']).preview, '"sample"');
});

test('preview paths tolerate removed values and reject invalid pagination or excessive depth', () => {
  assert.match(Preview.describe({}, ['missing']).preview, /no longer exists/);
  assert.match(Preview.describe([1], [2]).preview, /within bounds/);
  assert.throws(() => Preview.describe({}, Array(33).fill('x')), /path/);
  for (const limit of [0, -1, 501, 1.5]) assert.throws(() => Preview.describe({}, [], limit), /limit/);
  assert.throws(() => Preview.describe({}, [], 50, -1), /offset/);
});

for (const trace of [true, false]) {
  test(`App.preview follows live binding references across edits and patches (trace=${trace})`, async () => {
    const app = AppCore.new({ trace });
    app.graphics = {};
    app.services.graphics = { resetScene() {}, destroy() {}, render: (graphics, callback) => callback(Data.dict()) };
    app.requestFrame = () => 1; app.cancelFrame = () => {};
    try {
      await App.loadSource(app, '(let sample (dict "count" 1)) (on render (c))');
      const reference = App.inspect(app).sample;
      assert.equal(App.preview(app, reference, ['count']).preview, '1');
      App.exec(app, '(set sample.count 2)');
      assert.equal(App.preview(app, reference, ['count']).preview, '2');
      await App.patchSource(app, '(let sample (dict "count" 99)) (on render (c))');
      assert.equal(App.preview(app, reference, ['count']).preview, '2');
      await App.loadSource(app, '(on render (c))');
      assert.throws(() => App.preview(app, reference), /binding/i);
    } finally { AppCore.destroy(app); }
  });
}
