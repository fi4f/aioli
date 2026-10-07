import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { arithmetic } from '../engine/arithmetic.js';
import { vectorBindings } from '../engine/types.js';
import { vectorTypes, vectorInfo } from '../engine/numeric-types.js';

const operators = ['+', '-', '*', '/', '%'];
function reference(operator, x, y, scalar) {
  let value;
  switch (operator) {
    case '+': value = 0 + x + y; break;
    case '-': value = x - y; break;
    case '*': value = scalar === 'f32' ? x * y : Math.imul(x, y); break;
    case '/': value = x / y; break;
    case '%': value = x % y; break;
  }
  return scalar === 'f32' ? Math.fround(value) : scalar === 'i32' ? Math.trunc(value) | 0 : Math.trunc(value) >>> 0;
}

test('generated arithmetic stays current', () => {
  execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/generate-arithmetic.mjs', import.meta.url)), '--check']);
});

test('all vector operators and broadcast directions match numeric family semantics', () => {
  for (const type of vectorTypes) {
    const { size, scalar } = vectorInfo(type), make = vectorBindings[type];
    const seeds = scalar === 'f32' ? [-0, 0.1, -3.5, 16777216] : scalar === 'i32' ? [-2147483648, 2147483647, -7, 9] : [4294967295, 2147483648, 7, 9];
    const left = make(...seeds.slice(0, size)), right = make(...[3, 7, 2, 5].slice(0, size));
    const original = [...left.values];
    for (const operator of operators) for (const [a, b] of [[left, right], [left, 3], [3, right]]) {
      const result = arithmetic[operator](a, b);
      const expected = Array.from({ length: size }, (_, i) => reference(operator,
        typeof a === 'number' ? a : a.values[i], typeof b === 'number' ? b : b.values[i], scalar));
      assert.equal(result.type, type);
      assert.deepEqual(result.values, expected, `${type} ${operator}`);
      assert.notEqual(result.values, left.values);
      assert.equal(Object.isFrozen(result), true);
      assert.equal(Object.isSealed(result.values), true);
    }
    assert.deepEqual(left.values, original);
    const chain = arithmetic['+'](left, right, left);
    assert.deepEqual(chain.values, original.map((x, i) => reference('+', reference('+', x, right.values[i], scalar), x, scalar)));
    for (const operator of ['+', '*']) {
      const result = arithmetic[operator](left);
      assert.deepEqual(result.values, left.values);
      assert.notEqual(result.values, left.values);
    }
    const negative = arithmetic['-'](left);
    assert.deepEqual(negative.values, original.map(x => scalar === 'f32' ? Math.fround(-x) : scalar === 'i32' ? Math.trunc(-x) | 0 : Math.trunc(-x) >>> 0));
    const reciprocal = arithmetic['/'](right);
    assert.deepEqual(reciprocal.values, right.values.map(x => scalar === 'f32' ? Math.fround(1 / x) : Math.trunc(1 / x)));
  }
});

test('arithmetic preserves float edge cases, broadcast rounding, and validation', () => {
  const make = vectorBindings.vec4f;
  assert.deepEqual(arithmetic['+'](make(-0, NaN, Infinity, -Infinity), make(-0, 1, 1, 1)).values, [0, NaN, Infinity, -Infinity]);
  assert.deepEqual(arithmetic['/'](make(0, -0, Infinity, NaN)).values, [Infinity, -Infinity, 0, NaN]);
  const value = vectorBindings.vec2f(16777216, -0);
  assert.deepEqual(arithmetic['+'](value, 16777217).values, value.values.map(x => Math.fround(0 + x + Math.fround(16777217))));
  assert.deepEqual(arithmetic['+'](vectorBindings.vec2f(16777216), 1, -16777216).values, [0, 0]);
  for (const type of vectorTypes.filter(type => !type.endsWith('f'))) {
    const makeInteger = vectorBindings[type], good = makeInteger(7), zero = makeInteger(0);
    for (const operator of ['/', '%']) {
      assert.throws(() => arithmetic[operator](good, zero), RangeError);
      assert.throws(() => arithmetic[operator](good, 0), RangeError);
      assert.throws(() => arithmetic[operator](7, zero), RangeError);
    }
    assert.throws(() => arithmetic['/'](zero), /requires a finite number/);
    for (const scalar of [0.5, NaN, Infinity]) assert.throws(() => arithmetic['+'](good, scalar), TypeError);
    assert.throws(() => arithmetic['%'](good), TypeError);
    assert.throws(() => arithmetic['%'](good, good, good), TypeError);
  }
  const corrupted = vectorBindings.vec2f(1);
  corrupted.values[1] = 'bad';
  assert.throws(() => arithmetic['+'](corrupted, 2), TypeError);
  assert.throws(() => arithmetic['+'](value, vectorBindings.vec3f(1)), TypeError);
  assert.throws(() => arithmetic['+'](value, vectorBindings.vec2i(1)), TypeError);
});
