import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../engine/compiler.js';
import { forms } from '../engine/forms.js';
import { bindings } from '../engine/bindings.js';
import { createStruct, createZeroArray, collectionInfo } from '../engine/structures.js';
import { get, put, copy, reCopy, equal } from '../engine/data.js';

test('struct field indexes support special keys, reordered arguments, and definition identity', () => {
  const declarations = [['__proto__', 'f32'], ['constructor', 'i32'], ['', 'u32'], ['a string key', 'bool']];
  const Example = createStruct('Example', declarations);
  const Other = createStruct('Example', [['__proto__', 'bool']]);
  const value = Example('a string key', true, '', 4294967295, 'constructor', -7, '__proto__', 0.5);
  for (const [key, type] of declarations) assert.equal(get(Example, key), type);
  assert.equal(get(Other, '__proto__'), 'bool');
  assert.equal(get(value, '__proto__'), 0.5);
  assert.equal(get(value, 'constructor'), -7);
  assert.equal(get(value, ''), 4294967295);
  assert.equal(get(value, 'a string key'), true);
  assert.throws(() => get(Example, 'toString'), /Unknown Example field/);
  assert.throws(() => Example('__proto__', 1, '__proto__', 2, '', 3, 'a string key', true), /duplicate/);
  assert.throws(() => Example('unknown', 1, 'constructor', 2, '', 3, 'a string key', true), /Unknown/);
});

test('struct declarations and construction support string keys, bare labels, and definition access', () => {
  for (const trace of [true, false]) {
    const output = [];
    const evaluate = source => compile(source, { ...bindings, print: value => output.push(value) }, forms, { trace }).run();
    const result = evaluate(`(struct Example "a string key":vec2f age:f32)
      (let example (Example age 2 "a string key" (vec2f 0 0)))
      (print example."a string key")
      (set example."a string key".x 5)
      (set example.age 3)
      (get example "a string key")`);
    assert.deepEqual(result.values, [5, 0]);
    assert.equal(output.length, 1);
    assert.equal(evaluate('(struct Example "a string key":vec2f) (get Example "a string key")'), 'vec2f');
    assert.equal(evaluate('(struct Example "a string key":vec2f) Example."a string key"'), 'vec2f');
    assert.equal(evaluate('(struct Example "":f32) (let example (Example "" 2)) example.""'), 2);
    for (const source of [
      '(struct Example "same":f32 same:f32)', '(struct Example)', '(struct Example key f32)',
      '(struct Example key:str)', '(struct f32 x:f32)',
      '(struct Example key:f32) (Example)', '(struct Example key:f32) (Example wrong 1)',
      '(struct Example key:f32) (Example key "1")',
    ]) assert.throws(() => evaluate(source), error => error instanceof Error && (!trace || Boolean(error.lisp)), source);
  }
});

test('typed arrays expose live structs and vector/matrix fields while copies are independent', () => {
  const Position = createStruct('Position', [['point', 'vec3f'], ['matrix', 'mat3x3f'], ['weight', 'f32']]);
  const value = Position('point', bindings.vec3f(1, 2, 3), 'matrix', bindings.mat3x3f(1, 0, 0, 0, 1, 0, 0, 0, 1), 'weight', 0.5);
  const values = createZeroArray(Position, 2);
  assert.equal(bindings.len(values), 2);
  put(values, 0, value);
  const live = get(values, 0);
  put(get(live, 'point'), 0, 9);
  assert.equal(get(get(get(values, 0), 'point'), 0), 9);
  assert.equal(get(get(value, 'point'), 0), 1);
  const duplicate = copy(live);
  put(get(duplicate, 'point'), 0, 42);
  assert.equal(get(get(live, 'point'), 0), 9);
  const independent = copy(values);
  put(get(independent, 0), 'weight', 1);
  assert.equal(get(live, 'weight'), 0.5);
  assert.equal(equal(live, reCopy(live)), true);
  const shared = bindings.dict('a', values, 'b', values);
  const duplicated = reCopy(shared);
  assert.equal(get(duplicated, 'a'), get(duplicated, 'b'));
  assert.notEqual(get(duplicated, 'a'), values);
  assert.ok(collectionInfo(values).revision > 0);
  assert.equal(bindings.len(createZeroArray('f32', 0)), 0);
});

test('nested structs, padded matrix storage, and zero initialization follow the declared struct', () => {
  const Inner = createStruct('Inner', [['v', 'vec2f']]);
  const Outer = createStruct('Outer', [['nested', Inner], ['matrix', 'mat3x3f']]);
  const values = createZeroArray(Outer, 1), record = get(values, 0);
  assert.deepEqual(get(get(record, 'nested'), 'v').values, [0, 0]);
  put(record, 'matrix', bindings.mat3x3f(1, 2, 3, 4, 5, 6, 7, 8, 9));
  assert.deepEqual(Array.from(get(record, 'matrix').values), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(Array.from(collectionInfo(values).storage), [0, 0, 0, 0, 1, 2, 3, 0, 4, 5, 6, 0, 7, 8, 9, 0]);
  const scalar = createZeroArray('f32', 1);
  put(scalar, 0, 0.1);
  assert.equal(get(scalar, 0), Math.fround(0.1));
});

test('array and struct mutation validates types and bounds atomically', () => {
  const Example = createStruct('Example', [['v', 'vec2f']]);
  const value = Example('v', bindings.vec2f(1, 2)), values = createZeroArray(Example, 1);
  put(values, 0, value);
  for (const invalid of [null, 'wrong', bindings.vec2f(1), createStruct('Other', [['v', 'vec2f']])('v', bindings.vec2f(1))]) {
    assert.throws(() => put(values, 0, invalid), TypeError);
  }
  const live = get(values, 0);
  assert.throws(() => put(live, 'missing', 1), TypeError);
  assert.throws(() => put(live, 'v', bindings.vec2f(3, Infinity)), TypeError);
  assert.deepEqual(Array.from(get(live, 'v').values), [1, 2]);
  for (const at of [-1, 1, 0.5, null, '0']) assert.throws(() => get(values, at), RangeError);
  assert.throws(() => createZeroArray('f32', -1), RangeError);
  assert.throws(() => createZeroArray('string', 1), TypeError);
  assert.throws(() => createZeroArray(bindings.list(1), 1), TypeError);
  assert.throws(() => put(Example, 'v', 1), TypeError);
});

test('dot set evaluates target and replacement once and validates writable swizzles', () => {
  for (const trace of [true, false]) {
    const events = [], target = bindings.dict('v', bindings.vec2f(1, 2));
    const evaluate = source => compile(source, { ...bindings,
      target: () => { events.push('target'); return target; }, next: () => { events.push('value'); return 5; },
    }, forms, { trace }).run();
    assert.equal(evaluate('(set (target).v.x (next))'), 5);
    assert.deepEqual(events, ['target', 'value']);
    assert.deepEqual(evaluate('(let v (vec2f 1 2)) (set v.xy v.yx) v').values, [2, 1]);
    assert.equal(evaluate('(let items (list 1)) (set items.0 2) items.0'), 2);
    assert.equal(evaluate('(let object (dict)) (set object."a.b" 3) object."a.b"'), 3);
    for (const source of ['(let v (vec2f 1)) (set v.xx (vec2f 2))', '(let v (vec2f 1)) (set v.z 1)', '(let v (vec2f 1)) (set v.xy (vec3f 1))']) assert.throws(() => evaluate(source), TypeError);
    assert.equal(evaluate(`(struct Example "a string key":vec2f)
      (let values (array (Example 1) (Example "a string key" (vec2f 0))))
      (set values.0."a string key".x 0.5)
      (get (get (get values 0) "a string key") 0)`), 0.5);
  }
});

test('shader array access and quoted struct keys generate readonly storage and typed struct fields', () => {
  const source = `(struct Example "a string key":vec2f gain:f32)
    (sh (items:array<Example>)
      (let item (get items 0))
      (set item."a string key".x 0.5)
      (let count (len items))
      (return (vec4f items.0."a string key" (get item "gain") 1)))`;
  const result = compile(source, bindings, forms).shaders[0];
  assert.match(result.wgsl, /var<storage, read> resource0: array<Struct0>/);
  assert.match(result.wgsl, /f0: vec2f/);
  assert.match(result.wgsl, /readStorage1\(0f\)/);
  assert.match(result.wgsl, /floor\(index\) != index/);
  assert.equal(result.uniformCount, 1);
  assert.throws(() => compile('(sh (items:array<f32>) (set items.0 1) (return (vec4f 1)))', {}, forms), /read-only/);
  assert.throws(() => compile('(sh () (let v (vec2f 1)) (set v.xx (vec2f 2)) (return (vec4f 1)))', {}, forms), /swizzle/);
});
