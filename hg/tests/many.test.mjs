import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Compiler } from "../compiler.js";
import { Forms } from "../forms.js";
import { Bindings } from "../bindings.js";
import { Structures } from "../structures.js";
import { Data } from "../data.js";
const evaluate = (source, trace = true) => Compiler.run(Compiler.compile(source, Bindings, Forms, { trace }));

test('unbounded many grows while length tracks insertion and removal, retaining capacity', () => {
  for (const trace of [true, false]) {
    const value = evaluate('(many (f32) 1 2)', trace);
    assert.equal(value.type, 'many');
    Data.insert(value, 3); Data.insert(value, 4, 0);
    assert.equal(Bindings.len(value), 4);
    assert.deepEqual(Array.from({ length: 4 }, (_, i) => Data.get(value, i)), [4, 1, 2, 3]);
    const capacity = Bindings.cap(value);
    Data.remove(value, 1);
    assert.deepEqual(Array.from({ length: 3 }, (_, i) => Data.get(value, i)), [4, 2, 3]);
    assert.equal(Bindings.cap(value), capacity);
    assert.equal(Data.remove(value, null), value);
    assert.equal(Bindings.where(value, 2), 1);
    assert.equal(Bindings.in(3, value), true);
    const empty = evaluate('(many (vec2f))', trace);
    assert.equal(Data.bool(empty), false);
    Data.insert(empty, Bindings.vec2f(1));
    assert.equal(Data.bool(empty), true);
    assert.equal(Bindings.len(empty), 1);
    Data.remove(empty, 0);
    assert.equal(Data.bool(empty), false);
    assert.throws(() => Data.get(empty, 0), RangeError);
  }
});

test('bounded many limits active length and validates mutations atomically', () => {
  for (const trace of [true, false]) {
    const value = evaluate('(many (f32 2) 1)', trace);
    assert.equal(Bindings.len(value), 1); assert.equal(Bindings.cap(value), 2);
    assert.throws(() => Data.put(value, 1, 2), RangeError);
    Data.insert(value, 2);
    assert.throws(() => Data.insert(value, 3), /capacity/);
    assert.throws(() => Data.insert(value, 'wrong', 0), TypeError);
    assert.throws(() => Data.insert(value, 3, -1), RangeError);
    assert.deepEqual([Data.get(value, 0), Data.get(value, 1)], [1, 2]);
    Data.remove(value, 0); Data.insert(value, 3);
    assert.deepEqual([Data.get(value, 0), Data.get(value, 1)], [2, 3]);
    for (const source of ['(many)', '(many f32)', '(many (f32 0))', '(many (f32 nil))', '(many (string))', '(many (f32 1) 1 2)', '(many (vec2f) (vec3f 1))']) assert.throws(() => evaluate(source, trace), Error, source);
    assert.equal(evaluate('(let a (many (f32))) (a : many)', trace).type, 'many');
    assert.throws(() => evaluate('(let a (array (f32) 1)) (insert a 2)', trace), /list/);
  }
});

test('live nested views follow reallocation and copies preserve length and bounds independently', () => {
  const value = evaluate('(struct S p:vec3f m:mat3x3f) (many (S) (S p (vec3f 1 2 3) m (mat3x3f 1 0 0 0 1 0 0 0 1)))');
  const live = Data.get(value, 0), p = Data.get(live, 'p'), matrix = Data.get(live, 'm');
  const duplicate = Data.copy(value);
  for (let i = 0; i < 8; i++) Data.insert(value, Data.copy(live));
  Data.put(p, 0, 7); Data.put(matrix, 0, 8);
  assert.equal(Data.get(Data.get(Data.get(value, 0), 'p'), 0), 7);
  assert.equal(Data.get(Data.get(Data.get(value, 0), 'm'), 0), 8);
  assert.equal(Data.get(Data.get(Data.get(duplicate, 0), 'p'), 0), 1);
  assert.equal(Structures.collectionInfo(duplicate).bounded, false);
  Data.insert(duplicate, Data.copy(live));
  assert.equal(Bindings.len(duplicate), 2);
  assert.equal(Data.equal(value, Data.reCopy(value)), true);
  const bounded = Data.copy(evaluate('(many (f32 1) 1)'));
  assert.throws(() => Data.insert(bounded, 2), /capacity/);
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
    const points = Data.get(value, 'some points');
    assert.equal(Bindings.len(points), 1); assert.equal(Bindings.cap(points), 3);
    assert.equal(Data.get(Data.get(Data.get(points, 0), 'p'), 0), 4);
    assert.equal(Data.get(Data.get(Data.get(value, 'nested'), 1), 0), 2);
    const duplicate = Data.copy(value);
    Data.put(Data.get(Data.get(points, 0), 'p'), 0, 9);
    assert.equal(Data.get(Data.get(Data.get(Data.get(duplicate, 'some points'), 0), 'p'), 0), 4);
    for (const source of ['(struct S a:many<f32>)', '(struct S a:many<f32,0>)', '(struct S a:many<f32,2>) (S a (array (f32) 1))']) assert.throws(() => evaluate(source, trace), Error);
  }
});

test('many compiles into shader resources, bounded struct values, and local helper arguments', () => {
  const program = Compiler.compile(`(struct S p:many<vec2f,3>)
    (sh (items:many<S> bounded:many<f32,4>)
      (let s items.0)
      (set s.p.0.x 0.5)
      (let local (many (f32 2) 0.25))
      (let first (fn (a:many<f32,2>) (return a.0)))
      (return (vec4f s.p.0 (first local) (f32 (bool bounded)))))`, Bindings, Forms).shaders[0];
  assert.match(program.wgsl, /length: f32/);
  assert.match(program.wgsl, /data: array<vec2f, 3>/);
  assert.match(program.wgsl, /index < value.length/);
  assert.match(program.wgsl, /if \(0f < .*length\)/);
  assert.equal(program.uniforms[0].collection, 'many');
  assert.equal(program.uniforms[1].capacity, 4);
});
