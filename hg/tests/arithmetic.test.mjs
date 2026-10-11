import { Data } from '../data.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Arithmetic } from "../arithmetic.js";
import { Types } from "../types.js";
import { NumericTypes } from "../numeric-types.js";

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
  execFileSync(process.execPath, [fileURLToPath(new URL('../tools/generate-arithmetic.mjs', import.meta.url)), '--check']);
});

test('all vector operators and broadcast directions match numeric family semantics', () => {
  for (const type of NumericTypes.vectorTypes) {
    const { size, scalar } = NumericTypes.vectorInfo(type), make = Types.vectorBindings[type];
    const seeds = scalar === 'f32' ? [-0, 0.1, -3.5, 16777216] : scalar === 'i32' ? [-2147483648, 2147483647, -7, 9] : [4294967295, 2147483648, 7, 9];
    const left = make(...seeds.slice(0, size)), right = make(...[3, 7, 2, 5].slice(0, size));
    const original = [...Data.values(left)];
    for (const operator of operators) for (const [a, b] of [[left, right], [left, 3], [3, right]]) {
      const result = Arithmetic.bindings[operator](a, b);
      const expected = Array.from({ length: size }, (_, i) => reference(operator,
        typeof a === 'number' ? a : Data.values(a)[i], typeof b === 'number' ? b : Data.values(b)[i], scalar));
      assert.equal(result.__type__, type);
      assert.deepEqual(Data.values(result), expected, `${type} ${operator}`);
      assert.notEqual(Data.values(result), Data.values(left));
      assert.equal(Object.isFrozen(result), false);
      assert.equal(Object.isSealed(Data.values(result)), false);
    }
    assert.deepEqual(Data.values(left), original);
    const chain = Arithmetic.bindings['+'](left, right, left);
    assert.deepEqual(Data.values(chain), original.map((x, i) => reference('+', reference('+', x, Data.values(right)[i], scalar), x, scalar)));
    for (const operator of ['+', '*']) {
      const result = Arithmetic.bindings[operator](left);
      assert.deepEqual(Data.values(result), Data.values(left));
      assert.notEqual(Data.values(result), Data.values(left));
    }
    const negative = Arithmetic.bindings['-'](left);
    assert.deepEqual(Data.values(negative), original.map(x => scalar === 'f32' ? Math.fround(-x) : scalar === 'i32' ? Math.trunc(-x) | 0 : Math.trunc(-x) >>> 0));
    const reciprocal = Arithmetic.bindings['/'](right);
    assert.deepEqual(Data.values(reciprocal), Data.values(right).map(x => scalar === 'f32' ? Math.fround(1 / x) : Math.trunc(1 / x)));
  }
});

test('arithmetic preserves float edge cases, broadcast rounding, and validation', () => {
  const make = Types.vectorBindings.vec4f;
  assert.throws(() => Arithmetic.bindings['+'](make(-0, NaN, Infinity, -Infinity), make(-0, 1, 1, 1)), TypeError);
  assert.throws(() => Arithmetic.bindings['/'](make(0, -0, 1, 2)), TypeError);
  const value = Types.vectorBindings.vec2f(16777216, -0);
  assert.deepEqual(Data.values(Arithmetic.bindings['+'](value, 16777217)), Data.values(value).map(x => Math.fround(0 + x + Math.fround(16777217))));
  assert.deepEqual(Data.values(Arithmetic.bindings['+'](Types.vectorBindings.vec2f(16777216), 1, -16777216)), [0, 0]);
  for (const type of NumericTypes.vectorTypes.filter(type => !type.endsWith('f'))) {
    const makeInteger = Types.vectorBindings[type], good = makeInteger(7), zero = makeInteger(0);
    for (const operator of ['/', '%']) {
      assert.throws(() => Arithmetic.bindings[operator](good, zero), RangeError);
      assert.throws(() => Arithmetic.bindings[operator](good, 0), RangeError);
      assert.throws(() => Arithmetic.bindings[operator](7, zero), RangeError);
    }
    assert.throws(() => Arithmetic.bindings['/'](zero), /requires a finite number/);
    for (const scalar of [0.5, NaN, Infinity]) assert.throws(() => Arithmetic.bindings['+'](good, scalar), TypeError);
    assert.throws(() => Arithmetic.bindings['%'](good), TypeError);
    assert.throws(() => Arithmetic.bindings['%'](good, good, good), TypeError);
  }
  const corrupted = Types.vectorBindings.vec2f(1);
  corrupted.y = 'bad';
  assert.throws(() => Arithmetic.bindings['+'](corrupted, 2), TypeError);
  assert.throws(() => Arithmetic.bindings['+'](value, Types.vectorBindings.vec3f(1)), TypeError);
  assert.throws(() => Arithmetic.bindings['+'](value, Types.vectorBindings.vec2i(1)), TypeError);
});
