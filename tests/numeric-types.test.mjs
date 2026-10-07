import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../engine/compiler.js';
import { forms } from '../engine/forms.js';
import { bindings } from '../engine/bindings.js';
import { num, f32, i32, u32, str } from '../engine/conversions.js';
import { assertType, vectorBindings } from '../engine/types.js';
import { vectorTypes, vectorInfo } from '../engine/numeric-types.js';
import { get, put, copy, serializeData, deserializeData } from '../engine/data.js';
import { collectionInfo, packCollection } from '../engine/structures.js';
const evaluate = (source, trace = true) => compile(source, bindings, forms, { trace }).run();

test('obsolete type names and constructor bindings are removed', () => {
  for (const name of ['float', 'string', 'boolean']) {
    assert.equal(Object.hasOwn(bindings, name), false);
    assert.throws(() => assertType(1, name), /Unknown type/);
    assert.throws(() => evaluate(`(1 : ${name})`), SyntaxError);
    assert.throws(() => evaluate(`(${name} 1)`), SyntaxError);
    assert.throws(() => compile(`(sh (x:${name}) (return (vec4f 1)))`, bindings, forms), SyntaxError);
  }
});

test('num, f32, i32, u32, and str conversions preserve precision or explicitly round and wrap', () => {
  assert.equal(num('0.1'), 0.1); assert.equal(f32('0.1'), Math.fround(0.1));
  assert.equal(i32(4294967295), -1); assert.equal(u32(-1), 4294967295);
  assert.equal(i32(2147483648), -2147483648);
  assert.equal(u32(4294967296), 0); assert.equal(i32(-1.9), -1); assert.equal(u32(-1.9), 4294967295);
  assert.equal(i32(true), 1); assert.equal(str(null), 'nil');
  assert.equal(str(-0), '-0'); assert.ok(Number.isNaN(f32(NaN)));
  for (const conversion of [i32, u32]) for (const value of [Infinity, -Infinity, NaN, null, '']) assert.throws(() => conversion(value), Error);
  for (const conversion of [num, f32, i32, u32, str]) { assert.throws(() => conversion(), TypeError); assert.throws(() => conversion(1, 2), TypeError); }
  for (const trace of [true, false]) {
    assert.equal(evaluate('(u32 -1)', trace), 4294967295);
    assert.equal(evaluate('(f32 0.1)', trace), Math.fround(0.1));
    assert.equal(evaluate('(str (i32 4294967295))', trace), '-1');
  }
});

test('scalar and vector guards validate representation, signed ranges, and exact component families', () => {
  assert.equal(assertType(0.1, 'num'), 0.1);
  assert.throws(() => assertType(0.1, 'f32'), TypeError);
  assert.equal(assertType(Math.fround(0.1), 'f32'), Math.fround(0.1));
  for (const [type, valid, invalid] of [['i32', -2147483648, 2147483648], ['u32', 4294967295, -1]]) {
    assert.equal(assertType(valid, type), valid); assert.throws(() => assertType(invalid, type), TypeError);
    assert.equal(bindings[`${type}?`](valid), true); assert.equal(bindings[`${type}?`](invalid), false);
  }
  assert.equal(bindings['num?'](1), true); assert.equal(bindings['str?']('x'), true); assert.equal(bindings['str?'](1), false);
  for (const type of vectorTypes) {
    const value = vectorBindings[type](1);
    assert.equal(value.type, type); assert.equal(bindings[`${type}?`](value), true);
    assert.equal(bindings[`${type}?`](bindings.list(1)), false);
    assert.equal(assertType(value, type), value);
    assert.equal(evaluate(`((${type} 1) : ${type})`).type, type);
  }
});

test('all typed vector constructors, swizzles, copies, mutation, arithmetic, and JSON preserve their family', () => {
  for (const trace of [true, false]) for (const type of vectorTypes) {
    const info = vectorInfo(type), value = evaluate(`(${type} 1)`, trace);
    assert.equal(value.values.length, info.size);
    assert.deepEqual(Array.from(value.values), Array(info.size).fill(1));
    assert.deepEqual(Array.from(evaluate(`(${type})`, trace).values), Array(info.size).fill(0));
    assert.equal(evaluate(`(${type} 1).xx`, trace).type, `vec2${info.suffix}`);
    assert.equal(evaluate(`(let v (${type} 1)) (set v.0 2) v.0`, trace), 2);
    const result = evaluate(`(+ (${type} 1) (${type} 2))`, trace);
    assert.deepEqual(Array.from(result.values), Array(info.size).fill(3));
    assert.equal(deserializeData(serializeData(value)).type, type);
    assert.notEqual(copy(value), value);
  }
  assert.deepEqual(evaluate('(vec2u (vec2i -1 2))').values, [4294967295, 2]);
  assert.deepEqual(evaluate('(vec2i (vec2f -1.9 2.9))').values, [-1, 2]);
  assert.deepEqual(evaluate('(+ (vec2u 4294967295) (vec2u 1))').values, [0, 0]);
  assert.deepEqual(evaluate('(* (vec2u 4294967295) (vec2u 4294967295))').values, [1, 1]);
  assert.deepEqual(evaluate('(/ (vec2i -7 7) (vec2i 2))').values, [-3, 3]);
  assert.deepEqual(evaluate('(% (vec2u 7 8) (vec2u 3))').values, [1, 2]);
  assert.throws(() => evaluate('(+ (vec2u 1) (vec2i 1))'), TypeError);
  assert.throws(() => put(evaluate('(vec2u 1)'), 0, -1), TypeError);
});

test('mixed struct and many packing preserves full-width integers and WGSL alignment', () => {
  const value = evaluate(`(struct Item f:f32 i:i32 u:u32 v:vec3u flags:many<i32,2>)
    (array (Item) (Item f (f32 0.1) i -2147483648 u 4294967295
      v (vec3u 4294967295 16777217 1) flags (many (i32 2) -1)))`);
  const state = collectionInfo(value), packed = packCollection(state), view = new DataView(packed.buffer);
  assert.equal(view.getFloat32(0, true), Math.fround(0.1));
  assert.equal(view.getInt32(4, true), -2147483648); assert.equal(view.getUint32(8, true), 4294967295);
  assert.equal(view.getUint32(16, true), 4294967295); assert.equal(view.getUint32(20, true), 16777217);
  const item = get(value, 0); put(item, 'u', 16777217);
  assert.equal(get(item, 'u'), 16777217);
  const before = [...state.storage];
  assert.throws(() => put(item, 'i', 2147483648), TypeError); assert.deepEqual([...state.storage], before);
  assert.throws(() => evaluate('(struct Bad x:num)'), SyntaxError);
  assert.throws(() => evaluate('(struct Bad x:str)'), SyntaxError);
});

test('new shader numeric types compile constructors, guards, casts, arithmetic, and typed uniforms', () => {
  const source = `(struct Item i:i32 u:u32 p:vec3u)
    (sh (items:array<Item> i:i32 u:u32 v:vec2i)
      (let item items.0) (let input v)
      (let local (+ item.p (vec3u 1)))
      (set local.xy (vec2u 2 3))
      (let converted (vec3f local))
      (let signed (vec2i (vec2f -1.9 2.9)))
      (return (vec4f converted.xy (f32 (+ i (i32 1))) (f32 (vec2i? signed)))))`;
  const program = compile(source, bindings, forms).shaders[0];
  assert.match(program.wgsl, /f0: i32/); assert.match(program.wgsl, /f1: u32/); assert.match(program.wgsl, /f2: vec3u/);
  assert.match(program.wgsl, /bitcast<i32>/); assert.match(program.wgsl, /bitcast<vec2i>/);
  assert.match(program.wgsl, /fn wrapU32/); assert.match(program.wgsl, /vec3f\(local/);
  for (const type of vectorTypes) {
    const shader = compile(`(sh (v:${type}) (let x (${type} v)) (return (vec4f (f32 x.x) 0 0 1)))`, bindings, forms).shaders[0];
    assert.match(shader.wgsl, /fn fragment/);
  }
  for (const type of ['num', 'str']) assert.throws(() => compile(`(sh (x:${type}) (return (vec4f 1)))`, bindings, forms), SyntaxError);
});
