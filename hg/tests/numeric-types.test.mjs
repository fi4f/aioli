import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Compiler } from '../compiler.js';
import { Forms } from '../forms.js';
import { Bindings } from '../bindings.js';
import { Conversions } from '../conversions.js';
import { Types } from '../types.js';
import { NumericTypes } from '../numeric-types.js';
import { Data } from '../data.js';
import { Structures } from '../structures.js';
const evaluate = (source, trace = true) =>
  Compiler.run(Compiler.compile(source, Bindings, Forms, { trace }));

test('numeric metadata is shared, extensible, and rejects unknown keys without coercion', () => {
  for (const type of NumericTypes.vectorTypes) {
    const info = NumericTypes.vectorInfo(type);
    assert.equal(NumericTypes.vectorInfo(type), info);
    assert.equal(Object.isFrozen(info), false);
    info.note = 'mutable metadata';
    assert.equal(info.note, 'mutable metadata');
    delete info.note;
    assert.equal(Data.values(Types.vectorBindings[type](1)).length, info.size);
  }
  for (const size of [2, 3, 4]) assert.equal(NumericTypes.matrixSize(`mat${size}x${size}f`), size);
  for (const type of [
    'vec2',
    'vec5f',
    'vec2f\n',
    '__proto__',
    'constructor',
    'toString',
    'mat2x3f',
    'mat5x5f',
    null,
    undefined,
    2,
    {
      toString() {
        throw new Error('coerced');
      },
    },
  ]) {
    assert.equal(NumericTypes.vectorInfo(type), null);
    assert.equal(NumericTypes.matrixSize(type), 0);
  }
});

test('obsolete type names and constructor bindings are removed', () => {
  for (const name of ['float', 'string', 'boolean']) {
    assert.equal(Object.hasOwn(Bindings, name), false);
    assert.throws(() => Types.assertType(1, name), /Unknown type/);
    assert.throws(() => evaluate(`(1 : ${name})`), SyntaxError);
    assert.throws(() => evaluate(`(${name} 1)`), SyntaxError);
    assert.throws(
      () => Compiler.compile(`(sh (x:${name}) (return (vec4f 1)))`, Bindings, Forms),
      SyntaxError,
    );
  }
});

test('num, f32, i32, u32, and str conversions preserve precision or explicitly round and clamp', () => {
  assert.equal(Conversions.num('0.1'), 0.1);
  assert.equal(Conversions.f32('0.1'), Math.fround(0.1));
  assert.equal(Conversions.i32(4294967295), 2147483647);
  assert.equal(Conversions.u32(-1), 0);
  assert.equal(Conversions.i32(2147483648), 2147483647);
  assert.equal(Conversions.u32(4294967296), 4294967295);
  assert.equal(Conversions.i32(-1.9), -1);
  assert.equal(Conversions.u32(-1.9), 0);
  assert.equal(Conversions.i32(true), 1);
  assert.equal(Conversions.str(null), 'nil');
  assert.equal(Conversions.str(-0), '-0');
  assert.throws(() => Conversions.f32(NaN), TypeError);
  for (const conversion of [Conversions.num, Conversions.f32, Conversions.i32, Conversions.u32])
    for (const value of [Infinity, -Infinity, NaN, null, ''])
      assert.throws(() => conversion(value), Error);
  for (const [conversion, expected] of [
    [Conversions.num, 0],
    [Conversions.f32, 0],
    [Conversions.i32, 0],
    [Conversions.u32, 0],
    [Conversions.str, ''],
  ]) {
    assert.equal(conversion(), expected);
    assert.throws(() => conversion(1, 2), TypeError);
  }
  for (const trace of [true, false]) {
    assert.equal(evaluate('-1:u', trace), 0);
    assert.equal(evaluate('0.1:f', trace), Math.fround(0.1));
    assert.equal(evaluate('(str (i32 4294967295))', trace), '2147483647');
  }
});

test('scalar and vector guards validate representation, signed ranges, and exact component families', () => {
  assert.equal(Types.assertType(0.1, 'num'), 0.1);
  assert.throws(() => Types.assertType(0.1, 'f32'), TypeError);
  assert.equal(Types.assertType(Math.fround(0.1), 'f32'), Math.fround(0.1));
  for (const [type, valid, invalid] of [
    ['i32', -2147483648, 2147483648],
    ['u32', 4294967295, -1],
  ]) {
    assert.equal(Types.assertType(valid, type), valid);
    assert.throws(() => Types.assertType(invalid, type), TypeError);
    assert.equal(Bindings[`${type}?`](valid), true);
    assert.equal(Bindings[`${type}?`](invalid), false);
  }
  assert.equal(Bindings['num?'](1), true);
  assert.equal(Bindings['str?']('x'), true);
  assert.equal(Bindings['str?'](1), false);
  for (const type of NumericTypes.vectorTypes) {
    const value = Types.vectorBindings[type](1);
    assert.equal(value.__type__, type);
    assert.equal(Bindings[`${type}?`](value), true);
    assert.equal(Bindings[`${type}?`](Bindings.list(1)), false);
    assert.equal(Types.assertType(value, type), value);
    assert.equal(evaluate(`((${type} 1) : ${type})`).__type__, type);
  }
});

test('all typed vector constructors, swizzles, copies, mutation, arithmetic, and JSON preserve their family', () => {
  for (const trace of [true, false])
    for (const type of NumericTypes.vectorTypes) {
      const info = NumericTypes.vectorInfo(type),
        value = evaluate(`(${type} 1)`, trace);
      assert.equal(Data.values(value).length, info.size);
      assert.deepEqual(Array.from(Data.values(value)), Array(info.size).fill(1));
      assert.deepEqual(
        Array.from(Data.values(evaluate(`(${type})`, trace))),
        Array(info.size).fill(0),
      );
      assert.equal(evaluate(`(${type} 1).xx`, trace).__type__, `vec2${info.suffix}`);
      assert.equal(evaluate(`(let v (${type} 1)) (set v.0 2) v.0`, trace), 2);
      const result = evaluate(`(+ (${type} 1) (${type} 2))`, trace);
      assert.deepEqual(Array.from(Data.values(result)), Array(info.size).fill(3));
      assert.equal(Data.deserializeData(Data.serializeData(value)).__type__, type);
      assert.notEqual(Data.copy(value), value);
    }
  assert.deepEqual(Data.values(evaluate('(vec2u (vec2i -1 2))')), [0, 2]);
  assert.deepEqual(Data.values(evaluate('(vec2i (vec2f -1.9 2.9))')), [-1, 2]);
  assert.deepEqual(Data.values(evaluate('(+ (vec2u 4294967295) (vec2u 1))')), [0, 0]);
  assert.deepEqual(Data.values(evaluate('(* (vec2u 4294967295) (vec2u 4294967295))')), [1, 1]);
  assert.deepEqual(Data.values(evaluate('(/ (vec2i -7 7) (vec2i 2))')), [-3, 3]);
  assert.deepEqual(Data.values(evaluate('(% (vec2u 7 8) (vec2u 3))')), [1, 2]);
  assert.throws(() => evaluate('(+ (vec2u 1) (vec2i 1))'), TypeError);
  assert.throws(() => Data.put(evaluate('(vec2u 1)'), 0, -1), TypeError);
});

test('mixed struct and many packing preserves full-width integers and WGSL alignment', () => {
  const value = evaluate(`(struct Item f:f32 i:i32 u:u32 v:vec3u flags:many<i32,2>)
    (array (Item) (Item f (f32 0.1) i -2147483648 u 4294967295
      v (vec3u 4294967295 16777217 1) flags (many (i32 2) -1)))`);
  const state = Structures.collectionInfo(value),
    packed = Structures.packCollection(state),
    view = new DataView(packed.buffer);
  assert.equal(view.getFloat32(0, true), Math.fround(0.1));
  assert.equal(view.getInt32(4, true), -2147483648);
  assert.equal(view.getUint32(8, true), 4294967295);
  assert.equal(view.getUint32(16, true), 4294967295);
  assert.equal(view.getUint32(20, true), 16777217);
  const item = Data.get(value, 0);
  Data.put(item, 'u', 16777217);
  assert.equal(Data.get(item, 'u'), 16777217);
  const before = [...state.storage];
  assert.throws(() => Data.put(item, 'i', 2147483648), TypeError);
  assert.deepEqual([...state.storage], before);
  assert.throws(() => evaluate('(struct Bad x:num)'), SyntaxError);
  assert.throws(() => evaluate('(struct Bad x:str)'), SyntaxError);
});

test('new shader numeric types compile constructors, guards, casts, arithmetic, and typed uniforms', () => {
  const source = `(struct Item i:i32 u:u32 p:vec3u)
    (sh (items:array<Item> i:i32 unsigned:u32 value:vec2i)
      (let item items.0) (let input value)
      (let local (+ item.p (vec3u (u32))))
      (set local.xy (vec2u 0x2:u 0b11:u))
      (let converted (vec3f local))
      (let signed (vec2i (vec2f -1.9 2.9)))
      (return (vec4f converted.xy (f32 (+ i 0:i)) (f32 (vec2i? signed)))))`;
  const program = Compiler.compile(source, Bindings, Forms).shaders[0];
  assert.match(program.wgsl, /f0: i32/);
  assert.match(program.wgsl, /f1: u32/);
  assert.match(program.wgsl, /f2: vec3u/);
  assert.match(program.wgsl, /bitcast<i32>/);
  assert.match(program.wgsl, /bitcast<vec2i>/);
  assert.match(program.wgsl, /fn clampI32/);
  assert.match(program.wgsl, /vec3f\(local/);
  for (const type of NumericTypes.vectorTypes) {
    const shader = Compiler.compile(
      `(sh (value:${type}) (let x (${type} value)) (return (vec4f (f32 x.x) 0 0 1)))`,
      Bindings,
      Forms,
    ).shaders[0];
    assert.match(shader.wgsl, /fn fragment/);
  }
  for (const type of ['num', 'str'])
    assert.throws(
      () => Compiler.compile(`(sh (x:${type}) (return (vec4f 1)))`, Bindings, Forms),
      SyntaxError,
    );
});
