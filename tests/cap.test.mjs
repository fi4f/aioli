import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cap, list, dict, insert, remove, put } from '../engine/data.js';
import { bindings } from '../engine/bindings.js';
import { compile } from '../engine/compiler.js';
import { forms } from '../engine/forms.js';

test('cap reports many allocation and lengths of arrays, lists, and dicts', () => {
  const items = list(1, 2);
  assert.equal(cap(items), 2);
  insert(items, 3); assert.equal(cap(items), 3);
  remove(items, 0); assert.equal(cap(items), 2);
  const fields = dict('__proto__', 1, '', 2);
  assert.equal(cap(fields), 2);
  put(fields, '', 3); assert.equal(cap(fields), 2);
  put(fields, 'other', 4); assert.equal(cap(fields), 3);
  assert.equal(cap(list()), 0); assert.equal(cap(dict()), 0);
  for (const trace of [true, false]) {
    const evaluate = source => compile(source, bindings, forms, { trace }).run();
    assert.equal(evaluate('(cap (array (f32 4) 1 2))'), 4);
    assert.equal(evaluate('(cap (array (f32)))'), 0);
    assert.equal(evaluate('(cap (many (f32 10) 1 2))'), 10);
    assert.equal(evaluate('(let a (many (f32) 1)) (insert a 2) (insert a 3) (remove a 0) (cap a)'), 4);
    assert.equal(evaluate('(let size cap) (size (list 1 2 3))'), 3);
    assert.throws(() => evaluate('(capacity (many (f32)))'), /Unknown symbol/);
  }
});

test('cap checks types and arity and evaluates its argument once', () => {
  for (const args of [[], [null], [1], ['x'], [true], [list(), list()], [bindings.vec2f(1)]]) assert.throws(() => cap(...args), /cap expects/);
  for (const trace of [true, false]) {
    let calls = 0;
    const result = compile('(cap (next))', { ...bindings, next: () => { calls++; return dict('a', 1); } }, forms, { trace }).run();
    assert.equal(result, 1); assert.equal(calls, 1);
  }
  assert.equal(Object.hasOwn(bindings, 'capacity'), false);
});

test('shader cap handles inputs and local arrays and many with no capacity spelling', () => {
  const program = compile(`(sh (a:array<f32> m:many<f32>)
    (let local (array (f32 4) 1))
    (let active (many (f32 3) 1))
    (return (vec4f (cap a) (cap m) (cap local) (cap active))))`, bindings, forms).shaders[0];
  assert.match(program.wgsl, /frame.values\[0\].y/);
  assert.match(program.wgsl, /frame.values\[1\].y/);
  assert.match(program.wgsl, /vec4f\(bitcast<f32>\(frame.values\[0\].y\), bitcast<f32>\(frame.values\[1\].y\), 4f, 3f\)/);
  assert.throws(() => compile('(sh () (return (vec4f (capacity (array (f32 2))))))', bindings, forms), /Unknown shader symbol/);
});
