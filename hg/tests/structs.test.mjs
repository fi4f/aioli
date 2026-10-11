import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Compiler } from "../compiler.js";
import { Forms } from "../forms.js";
import { Bindings } from "../bindings.js";
import { Structures } from "../structures.js";
import { Data } from "../data.js";

test('struct field indexes support special keys, reordered arguments, and definition identity', () => {
  const declarations = [['__proto__', 'f32'], ['constructor', 'i32'], ['', 'u32'], ['a string key', 'bool']];
  const Example = Structures.createStruct('Example', declarations);
  const Other = Structures.createStruct('Example', [['__proto__', 'bool']]);
  const value = Example('a string key', true, '', 4294967295, 'constructor', -7, '__proto__', 0.5);
  for (const [key, type] of declarations) assert.equal(Data.get(Example, key), type);
  assert.equal(Data.get(Other, '__proto__'), 'bool');
  assert.equal(Data.get(value, '__proto__'), 0.5);
  assert.equal(Data.get(value, 'constructor'), -7);
  assert.equal(Data.get(value, ''), 4294967295);
  assert.equal(Data.get(value, 'a string key'), true);
  assert.throws(() => Data.get(Example, 'toString'), /Unknown Example field/);
  assert.throws(() => Example('__proto__', 1, '__proto__', 2, '', 3, 'a string key', true), /duplicate/);
  assert.throws(() => Example('unknown', 1, 'constructor', 2, '', 3, 'a string key', true), /Unknown/);
});

test('struct declarations and construction support string keys, bare labels, and definition access', () => {
  for (const trace of [true, false]) {
    const output = [];
    const evaluate = source => Compiler.run(Compiler.compile(source, { ...Bindings, print: value => output.push(value) }, Forms, { trace }));
    const result = evaluate(`(struct Example "a string key":vec2f age:f32)
      (let example (Example age 2 "a string key" (vec2f 0 0)))
      (print example."a string key")
      (set example."a string key".x 5)
      (set example.age 3)
      (get example."a string key")`);
    assert.deepEqual(Data.values(result), [5, 0]);
    assert.equal(output.length, 1);
    assert.equal(evaluate('(struct Example "a string key":vec2f) (get Example."a string key")'), 'vec2f');
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
  const Position = Structures.createStruct('Position', [['point', 'vec3f'], ['matrix', 'mat3x3f'], ['weight', 'f32']]);
  const value = Position('point', Bindings.vec3f(1, 2, 3), 'matrix', Bindings.mat3x3f(1, 0, 0, 0, 1, 0, 0, 0, 1), 'weight', 0.5);
  const values = Structures.createZeroArray(Position, 2);
  assert.equal(Bindings.len(values), 2);
  Data.put(values, 0, value);
  const live = Data.get(values, 0);
  Data.put(Data.get(live, 'point'), 0, 9);
  assert.equal(Data.get(Data.get(Data.get(values, 0), 'point'), 0), 9);
  assert.equal(Data.get(Data.get(value, 'point'), 0), 1);
  const duplicate = Data.copy(live);
  Data.put(Data.get(duplicate, 'point'), 0, 42);
  assert.equal(Data.get(Data.get(live, 'point'), 0), 9);
  const independent = Data.copy(values);
  Data.put(Data.get(independent, 0), 'weight', 1);
  assert.equal(Data.get(live, 'weight'), 0.5);
  assert.equal(Data.equal(live, Data.reCopy(live)), true);
  const shared = Bindings.dict('a', values, 'b', values);
  const duplicated = Data.reCopy(shared);
  assert.equal(Data.get(duplicated, 'a'), Data.get(duplicated, 'b'));
  assert.notEqual(Data.get(duplicated, 'a'), values);
  assert.ok(Structures.collectionInfo(values).revision > 0);
  assert.equal(Bindings.len(Structures.createZeroArray('f32', 0)), 0);
});

test('nested structs, padded matrix storage, and zero initialization follow the declared struct', () => {
  const Inner = Structures.createStruct('Inner', [['v', 'vec2f']]);
  const Outer = Structures.createStruct('Outer', [['nested', Inner], ['matrix', 'mat3x3f']]);
  const values = Structures.createZeroArray(Outer, 1), record = Data.get(values, 0);
  assert.deepEqual(Data.values(Data.get(Data.get(record, 'nested'), 'v')), [0, 0]);
  Data.put(record, 'matrix', Bindings.mat3x3f(1, 2, 3, 4, 5, 6, 7, 8, 9));
  assert.deepEqual(Array.from(Data.values(Data.get(record, 'matrix'))), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(Array.from(Structures.collectionInfo(values).storage), [0, 0, 0, 0, 1, 2, 3, 0, 4, 5, 6, 0, 7, 8, 9, 0]);
  const scalar = Structures.createZeroArray('f32', 1);
  Data.put(scalar, 0, 0.1);
  assert.equal(Data.get(scalar, 0), Math.fround(0.1));
});

test('array and struct mutation validates types and bounds atomically', () => {
  const Example = Structures.createStruct('Example', [['v', 'vec2f']]);
  const value = Example('v', Bindings.vec2f(1, 2)), values = Structures.createZeroArray(Example, 1);
  Data.put(values, 0, value);
  for (const invalid of [null, 'wrong', Bindings.vec2f(1), Structures.createStruct('Other', [['v', 'vec2f']])('v', Bindings.vec2f(1))]) {
    assert.throws(() => Data.put(values, 0, invalid), TypeError);
  }
  const live = Data.get(values, 0);
  assert.throws(() => Data.put(live, 'missing', 1), TypeError);
  assert.throws(() => Data.put(live, 'v', Bindings.vec2f(3, Infinity)), TypeError);
  assert.deepEqual(Array.from(Data.values(Data.get(live, 'v'))), [1, 2]);
  for (const at of [-1, 1, 0.5, null, '0']) assert.throws(() => Data.get(values, at), RangeError);
  assert.throws(() => Structures.createZeroArray('f32', -1), RangeError);
  assert.throws(() => Structures.createZeroArray('string', 1), TypeError);
  assert.throws(() => Structures.createZeroArray(Bindings.list(1), 1), TypeError);
  assert.throws(() => Data.put(Example, 'v', 1), TypeError);
});

test('dot set evaluates target and replacement once and validates writable swizzles', () => {
  for (const trace of [true, false]) {
    const events = [], target = Bindings.dict('v', Bindings.vec2f(1, 2));
    const evaluate = source => Compiler.run(Compiler.compile(source, { ...Bindings,
      target: () => { events.push('target'); return target; }, next: () => { events.push('value'); return 5; },
    }, Forms, { trace }));
    assert.equal(evaluate('(set (target).v.x (next))'), 5);
    assert.deepEqual(events, ['target', 'value']);
    assert.deepEqual(Data.values(evaluate('(let v (vec2f 1 2)) (set v.xy v.yx) v')), [2, 1]);
    assert.equal(evaluate('(let items (list 1)) (set items.0 2) items.0'), 2);
    assert.equal(evaluate('(let object (dict)) (set object."a.b" 3) object."a.b"'), 3);
    for (const source of ['(let v (vec2f 1)) (set v.xx (vec2f 2))', '(let v (vec2f 1)) (set v.z 1)', '(let v (vec2f 1)) (set v.xy (vec3f 1))']) assert.throws(() => evaluate(source), TypeError);
    assert.equal(evaluate(`(struct Example "a string key":vec2f)
      (let values (array (Example 1) (Example "a string key" (vec2f 0))))
      (set values.0."a string key".x 0.5)
      (get (get (get values.0)."a string key").0)`), 0.5);
  }
});

test('shader array access and quoted struct keys generate readonly storage and typed struct fields', () => {
  const source = `(struct Example "a string key":vec2f gain:f32)
    (sh (items:array<Example>)
      (let item (get items.0))
      (set item."a string key".x 0.5)
      (let count (len items))
      (return (vec4f items.0."a string key" (get item."gain") 1)))`;
  const result = Compiler.compile(source, Bindings, Forms).shaders[0];
  assert.match(result.wgsl, /var<storage, read> resource0: array<Struct0>/);
  assert.match(result.wgsl, /f0: vec2f/);
  assert.match(result.wgsl, /readStorage1\(0f\)/);
  assert.match(result.wgsl, /floor\(index\) != index/);
  assert.equal(result.uniformCount, 1);
  assert.throws(() => Compiler.compile('(sh (items:array<f32>) (set items.0 1) (return (vec4f 1)))', {}, Forms), /read-only/);
  assert.throws(() => Compiler.compile('(sh () (let v (vec2f 1)) (set v.xx (vec2f 2)) (return (vec4f 1)))', {}, Forms), /swizzle/);
});
