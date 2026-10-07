import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../engine/compiler.js';
import { forms } from '../engine/forms.js';
import { bindings } from '../engine/bindings.js';
import { vectorTypes, vectorInfo } from '../engine/numeric-types.js';
const evaluate = (source, trace = true, extra = {}) => compile(source, { ...bindings, ...extra }, forms, { trace }).run();

test('vector constructors support WGSL zero, splat, scalar, mixed component, and conversion overloads', () => {
  for (const trace of [true, false]) for (const type of vectorTypes) {
    const { size, suffix } = vectorInfo(type);
    const components = Array.from({ length: size }, (_, i) => i + 1);
    assert.deepEqual(evaluate(`(${type})`, trace).values, Array(size).fill(0));
    assert.deepEqual(evaluate(`(${type} 7)`, trace).values, Array(size).fill(7));
    assert.deepEqual(evaluate(`(${type} ${components.join(' ')})`, trace).values, components);
    const mixed = size === 2 ? `(${type} (vec2${suffix} 1 2))` : size === 3 ? `(${type} (vec2${suffix} 1 2) 3)` : `(${type} 1 (vec2${suffix} 2 3) 4)`;
    assert.deepEqual(evaluate(mixed, trace).values, components);
    const converted = evaluate(`(${type} (vec${size}f ${components.join(' ')}))`, trace);
    assert.equal(converted.type, type); assert.deepEqual(converted.values, components);
    for (const source of [`(${type} ${Array(size + 1).fill(1).join(' ')})`, `(${type} (vec${size === 2 ? 3 : 2}f 1))`, `(${type} "1")`]) assert.throws(() => evaluate(source, trace), Error);
  }
  let calls = 0;
  const result = evaluate('(vec4 (next))', false, { next: () => { calls++; return 3; } });
  assert.deepEqual(result.values, [3, 3, 3, 3]); assert.equal(calls, 1);
});

test('matrix constructors support zero, column-wise, and column-major scalar-wise overloads', () => {
  for (const trace of [true, false]) for (const size of [2, 3, 4]) {
    const type = `mat${size}x${size}f`, alias = `mat${size}`;
    const components = Array.from({ length: size * size }, (_, i) => i + 1);
    const columns = Array.from({ length: size }, (_, column) => `(vec${size} ${components.slice(column * size, (column + 1) * size).join(' ')})`).join(' ');
    assert.deepEqual(evaluate(`(${type})`, trace).values, Array(size * size).fill(0));
    assert.deepEqual(evaluate(`(${alias})`, trace).values, Array(size * size).fill(0));
    assert.deepEqual(evaluate(`(${type} ${columns})`, trace).values, components);
    assert.deepEqual(evaluate(`(${alias} ${components.join(' ')})`, trace).values, components);
    assert.equal(evaluate(`(${type} ${columns}).1.0`, trace), size + 1);
    for (const source of [`(${type} 0)`, `(${alias} 1)`, `(${type} (vec${size}u 1))`, `(${type} ${Array(size).fill(1).join(' ')})`, `(${type} ${Array(size).fill(`(vec${size}i 1)`).join(' ')})`]) assert.throws(() => evaluate(source, trace), TypeError);
  }
  const events = [];
  const result = evaluate('(mat2 (column 1) (column 2))', true, { column: value => { events.push(value); return bindings.vec2(value, value + 1); } });
  assert.deepEqual(events, [1, 2]); assert.deepEqual(result.values, [1, 2, 2, 3]);
});

test('shader constructors emit native WGSL overloads and reject diagonal shorthand', () => {
  for (const size of [2, 3, 4]) {
    const type = `mat${size}x${size}f`, columns = Array(size).fill(`(vec${size}f 1)`).join(' '), scalars = Array(size * size).fill(1).join(' ');
    const source = `(sh () (let zero (${type})) (let columns (${type} ${columns}))
      (let scalars (mat${size} ${scalars})) (return (vec4 (+ zero.0.0 columns.0.0 scalars.0.0))))`;
    const wgsl = compile(source, bindings, forms).shaders[0].wgsl;
    assert.match(wgsl, new RegExp(`${type}\\(\\)`));
    assert.doesNotMatch(wgsl, /diagonal/);
    assert.throws(() => compile(`(sh () (let m (${type} 1)) (return (vec4 1)))`, bindings, forms), SyntaxError);
  }
  for (const type of vectorTypes) {
    const size = vectorInfo(type).size;
    const source = `(sh () (let zero (${type})) (let splat (${type} 2))
      (let components (${type} ${Array(size).fill(1).join(' ')})) (return (vec4f (f32 zero.x) (f32 splat.x) (f32 components.x) 1)))`;
    assert.match(compile(source, bindings, forms).shaders[0].wgsl, new RegExp(`${type}\\(\\)`));
  }
});
