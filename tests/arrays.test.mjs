import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, read } from '../engine/compiler/compiler.js';
import { forms } from '../engine/compiler/forms.js';
import { bindings } from '../engine/language/bindings.js';
import { collectionInfo, structInfo } from '../engine/language/structures.js';
import { get, put, copy, reCopy, equal, insert, remove } from '../engine/language/data.js';

const evaluate = (source, trace = true, extra = {}) => compile(source, { ...bindings, ...extra }, forms, { trace }).run();

test('arrays have a fixed explicit or inferred length with zero-filled remaining elements', () => {
  for (const trace of [true, false]) {
    const a = evaluate('(array (f32 4) 1 2)', trace);
    assert.equal(a.type, 'array');
    assert.equal(bindings.len(a), 4);
    assert.equal(collectionInfo(a).capacity, 4);
    assert.equal(get(a, 1), 2);
    assert.equal(get(a, 2), 0); assert.equal(get(a, 3), 0);
    put(a, 2, 3); put(a, 3, 4);
    assert.throws(() => insert(a, 5), /list/);
    assert.throws(() => remove(a, 1), /list/);
    assert.deepEqual(Array.from({ length: 4 }, (_, i) => get(a, i)), [1, 2, 3, 4]);
    const inferred = evaluate('(array (f32) 1 2)', trace);
    assert.equal(collectionInfo(inferred).capacity, 2);
    assert.throws(() => insert(inferred, 3), /list/);
    assert.throws(() => remove(inferred, 0), /list/);
    assert.deepEqual([get(inferred, 0), get(inferred, 1)], [1, 2]);
    const empty = evaluate('(array (f32))', trace);
    assert.equal(bindings.len(empty), 0);
    assert.throws(() => insert(empty, 1), /list/);
    assert.equal(bindings.len(evaluate('(array (vec3f 8))', trace)), 8);
    assert.throws(() => remove(a, null), /list/);
  }
});

test('arrays validate capacity, types, arity, and indices before mutation', () => {
  for (const trace of [true, false]) {
    for (const source of [
      '(array)', '(array f32 1)', '(array (f32 2 3))', '(array (f32 0))',
      '(array (f32 nil))', '(array (f32 -1))', '(array (f32 1.5))',
      '(array (f32 Infinity))', '(array (f32 16777217))', '(array (string) "x")',
      '(array (f32 1) 1 2)', '(array (vec2f) (vec3f 1))', '(array (f32) NaN)',
      '(array (f32) Infinity)', '(layout Point p:vec2f)', '(buffer "f32" 1)',
    ]) assert.throws(() => evaluate(source, trace), error => Boolean(!trace || error.lisp), source);
    const a = evaluate('(array (vec2f 2) (vec2f 1 2))', trace);
    for (const at of [-1, 2, 0.5, null, '0']) assert.throws(() => get(a, at), RangeError);
    assert.throws(() => put(a, 0, bindings.vec2f(3, Infinity)), TypeError);
    assert.throws(() => insert(a, bindings.vec3f(1)), TypeError);
    assert.equal(bindings.len(a), 2);
    assert.deepEqual(Array.from(get(a, 0).values), [1, 2]);
  }
});

test('struct array fields are inline, typed, padded, mutable views with independent copies', () => {
  for (const trace of [true, false]) {
    const value = evaluate(`
      (struct Point "a string key":vec3f transform:mat3x3f)
      (struct Shape "some points":array<Point, 3> weights:array<f32,2>)
      (let points (array (Point 3) (Point "a string key" (vec3f 1 2 3) transform (mat3x3f 1 0 0 0 1 0 0 0 1))))
      (let shape (Shape "some points" points weights (array (f32) 0.2)))
      (set points.0."a string key".x 99)
      (put shape."some points" 1 (Point "a string key" (vec3f 4 5 6) transform (mat3x3f 2 0 0 0 2 0 0 0 2)))
      (set shape."some points".1.transform.2.1 7)
      shape`, trace);
    const points = get(value, 'some points');
    assert.equal(bindings.len(points), 3);
    assert.equal(get(get(get(points, 0), 'a string key'), 0), 1);
    assert.equal(get(get(get(points, 1), 'transform'), 7), 7);
    const independent = copy(value), arrayCopy = copy(points);
    put(get(get(points, 0), 'a string key'), 0, 8);
    assert.equal(get(get(get(get(independent, 'some points'), 0), 'a string key'), 0), 1);
    assert.equal(get(get(get(arrayCopy, 0), 'a string key'), 0), 1);
    assert.equal(equal(value, reCopy(value)), true);
    assert.equal(structInfo(value).definition.size % structInfo(value).definition.align, 0);
    const revision = collectionInfo(points).revision;
    put(get(get(points, 0), 'a string key'), 0, 4);
    assert.ok(collectionInfo(points).revision > revision);
    assert.equal(get(get(get(points, 0), 'a string key'), 0), 4);
    put(value, 'some points', arrayCopy);
    assert.equal(bindings.len(points), 3); // Cached view follows replacement storage.
    assert.equal(get(get(get(points, 0), 'a string key'), 0), 1);
  }
});

test('structs reject unsized fields and incompatible array assignments atomically', () => {
  for (const trace of [true, false]) {
    for (const source of [
      '(struct Bad items:array<f32>)', '(struct Bad items:array<f32,0>)',
      '(struct Bad items:array<f32,-1>)', '(struct Bad items:array<string,2>)',
      '(struct Bad items:array<Missing,2>)',
      '(struct S a:array<f32,2>) (S a (array (f32) 1 2 3))',
      '(struct S a:array<f32,2>) (S a (list 1 2))',
      '(struct S a:array<f32,2>) (S a (array (vec2f) (vec2f 1)))',
    ]) assert.throws(() => evaluate(source, trace), Error, source);
    const s = evaluate('(struct S a:array<f32,2>) (S a (array (f32) 1 2))', trace);
    assert.throws(() => put(s, 'a', evaluate('(array (f32) 1 2 3)', trace)), TypeError);
    assert.deepEqual([get(get(s, 'a'), 0), get(get(s, 'a'), 1)], [1, 2]);
    assert.equal(evaluate('(let a (array (f32) 1)) (a : array)', trace).type, 'array');
    assert.equal(evaluate('(struct S x:f32) ((S x 1) : struct)', trace).type, 'struct');
  }
});

test('nested bounded array declarations and source evaluation order work', () => {
  for (const trace of [true, false]) {
    const events = [];
    const a = evaluate('(array (f32 (capacity)) (value 1) (value 2))', trace, {
      capacity: () => { events.push('capacity'); return 3; },
      value: n => { events.push(n); return n; },
    });
    assert.deepEqual(events, ['capacity', 1, 2]);
    assert.equal(collectionInfo(a).capacity, 3);
    assert.equal(evaluate(`(struct S grid:array<array<f32, 2>, 3>)
      (let s (S grid (array (array<f32,2> 3) (array (f32 2) 1 2))))
      (set s.grid.0.1 8) s.grid.0.1`, trace), 8);
  }
  assert.equal(read('(sh (a:array<vec2f, 4>) (return (vec4f 1)))')[0].items[1].items[2].name, 'array<vec2f,4>');
});

test('shader arrays support bounded resources, inline fields, local construction, and helpers', () => {
  const program = compile(`(struct Point p:vec2f)
    (struct Shape points:array<Point,2>)
    (sh (shapes:array<Shape,4> values:array<f32>)
      (let shape shapes.0)
      (set shape.points.0.p.x 0.5)
      (let local (array (f32 2) 0.25))
      (let first (fn (a:array<f32,2>) (return a.0)))
      (return (vec4f shape.points.0.p (first local) (len shape.points))))`, bindings, forms).shaders[0];
  assert.match(program.wgsl, /resource0: array<Struct\d+, 4>/);
  assert.doesNotMatch(program.wgsl, /length: f32/);
  assert.match(program.wgsl, /f0: array<Struct\d+, 2>/);
  assert.match(program.wgsl, /readArray\d+/);
  assert.equal(program.uniforms[0].capacity, 4);
  for (const source of [
    '(sh (a:array<f32,0>) (return (vec4f 1)))',
    '(sh (a:array<f32>) (set a.0 1) (return (vec4f 1)))',
    '(sh () (let a (array (f32 1) 1 2)) (return (vec4f 1)))',
    '(sh () (let a (array (vec2f 1) 1)) (return (vec4f 1)))',
  ]) assert.throws(() => compile(source, bindings, forms), Error);
});
