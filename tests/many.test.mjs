import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../engine/compiler.js';
import { forms } from '../engine/forms.js';
import { bindings } from '../engine/bindings.js';
import { collectionInfo } from '../engine/structures.js';
import { get, put, insert, remove, copy, reCopy, equal, bool } from '../engine/data.js';
const evaluate = (source, trace = true) => compile(source, bindings, forms, { trace }).run();

test('unbounded many grows while length tracks insertion and removal, retaining capacity', () => {
  for (const trace of [true, false]) {
    const value = evaluate('(many (f32) 1 2)', trace);
    assert.equal(value.type, 'many');
    insert(value, 3); insert(value, 4, 0);
    assert.equal(bindings.len(value), 4);
    assert.deepEqual(Array.from({ length: 4 }, (_, i) => get(value, i)), [4, 1, 2, 3]);
    const capacity = bindings.cap(value);
    remove(value, 1);
    assert.deepEqual(Array.from({ length: 3 }, (_, i) => get(value, i)), [4, 2, 3]);
    assert.equal(bindings.cap(value), capacity);
    assert.equal(remove(value, null), value);
    assert.equal(bindings.where(value, 2), 1);
    assert.equal(bindings.in(3, value), true);
    const empty = evaluate('(many (vec2f))', trace);
    assert.equal(bool(empty), false);
    insert(empty, bindings.vec2f(1));
    assert.equal(bool(empty), true);
    assert.equal(bindings.len(empty), 1);
    remove(empty, 0);
    assert.equal(bool(empty), false);
    assert.throws(() => get(empty, 0), RangeError);
  }
});

test('bounded many limits active length and validates mutations atomically', () => {
  for (const trace of [true, false]) {
    const value = evaluate('(many (f32 2) 1)', trace);
    assert.equal(bindings.len(value), 1); assert.equal(bindings.cap(value), 2);
    assert.throws(() => put(value, 1, 2), RangeError);
    insert(value, 2);
    assert.throws(() => insert(value, 3), /capacity/);
    assert.throws(() => insert(value, 'wrong', 0), TypeError);
    assert.throws(() => insert(value, 3, -1), RangeError);
    assert.deepEqual([get(value, 0), get(value, 1)], [1, 2]);
    remove(value, 0); insert(value, 3);
    assert.deepEqual([get(value, 0), get(value, 1)], [2, 3]);
    for (const source of ['(many)', '(many f32)', '(many (f32 0))', '(many (f32 nil))', '(many (string))', '(many (f32 1) 1 2)', '(many (vec2f) (vec3f 1))']) assert.throws(() => evaluate(source, trace), Error, source);
    assert.equal(evaluate('(let a (many (f32))) (a : many)', trace).type, 'many');
    assert.throws(() => evaluate('(let a (array (f32) 1)) (insert a 2)', trace), /list/);
  }
});

test('live nested views follow reallocation and copies preserve length and bounds independently', () => {
  const value = evaluate('(struct S p:vec3f m:mat3x3f) (many (S) (S p (vec3f 1 2 3) m (mat3x3f 1 0 0 0 1 0 0 0 1)))');
  const live = get(value, 0), p = get(live, 'p'), matrix = get(live, 'm');
  const duplicate = copy(value);
  for (let i = 0; i < 8; i++) insert(value, copy(live));
  put(p, 0, 7); put(matrix, 0, 8);
  assert.equal(get(get(get(value, 0), 'p'), 0), 7);
  assert.equal(get(get(get(value, 0), 'm'), 0), 8);
  assert.equal(get(get(get(duplicate, 0), 'p'), 0), 1);
  assert.equal(collectionInfo(duplicate).bounded, false);
  insert(duplicate, copy(live));
  assert.equal(bindings.len(duplicate), 2);
  assert.equal(equal(value, reCopy(value)), true);
  const bounded = copy(evaluate('(many (f32 1) 1)'));
  assert.throws(() => insert(bounded, 2), /capacity/);
});

test('bounded many fields pack active length, expose live mutations, and reject unsized fields', () => {
  for (const trace of [true, false]) {
    const value = evaluate(`(struct P p:vec3f)
      (struct S "some points":many<P,3> nested:array<many<f32,2>,2>)
      (let s (S "some points" (many (P) (P p (vec3f 1 2 3)))
        nested (array (many<f32,2> 2) (many (f32 2) 1))))
      (insert s."some points" (P p (vec3f 4 5 6)))
      (insert s.nested.1 2)
      (remove s."some points" 0) s`, trace);
    const points = get(value, 'some points');
    assert.equal(bindings.len(points), 1); assert.equal(bindings.cap(points), 3);
    assert.equal(get(get(get(points, 0), 'p'), 0), 4);
    assert.equal(get(get(get(value, 'nested'), 1), 0), 2);
    const duplicate = copy(value);
    put(get(get(points, 0), 'p'), 0, 9);
    assert.equal(get(get(get(get(duplicate, 'some points'), 0), 'p'), 0), 4);
    for (const source of ['(struct S a:many<f32>)', '(struct S a:many<f32,0>)', '(struct S a:many<f32,2>) (S a (array (f32) 1))']) assert.throws(() => evaluate(source, trace), Error);
  }
});

test('many compiles into shader resources, bounded struct values, and local helper arguments', () => {
  const program = compile(`(struct S p:many<vec2f,3>)
    (sh (items:many<S> bounded:many<f32,4>)
      (let s items.0)
      (set s.p.0.x 0.5)
      (let local (many (f32 2) 0.25))
      (let first (fn (a:many<f32,2>) (return a.0)))
      (return (vec4f s.p.0 (first local) (f32 (bool bounded)))))`, bindings, forms).shaders[0];
  assert.match(program.wgsl, /length: f32/);
  assert.match(program.wgsl, /data: array<vec2f, 3>/);
  assert.match(program.wgsl, /index < value.length/);
  assert.match(program.wgsl, /if \(0f < .*length\)/);
  assert.equal(program.uniforms[0].collection, 'many');
  assert.equal(program.uniforms[1].capacity, 4);
});
