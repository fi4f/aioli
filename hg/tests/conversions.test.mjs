import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Conversions } from '../conversions.js';
import { Compiler } from '../compiler.js';
import { Bindings } from '../bindings.js';
import { Forms } from '../forms.js';
import { Shader } from '../shader.js';

test('num converts booleans and complete numeric strings with optional conversion suffixes', () => {
  for (const [input, expected] of [
    [42, 42],
    [1.23456789012345, 1.23456789012345],
    [-0, -0],
    [true, 1],
    [false, 0],
    ['42:u', 42],
    [' -0 ', -0],
    ['.5:f', 0.5],
    ['1.', 1],
    ['-1.25e+2:i', -125],
    ['0x10', 16],
    ['0b10', 2],
  ])
    assert.ok(Object.is(Conversions.num(input), expected), String(input));
  for (const input of [
    NaN,
    Infinity,
    -Infinity,
    'NaN',
    'Infinity',
    '+Infinity',
    '-Infinity',
    '',
    ' ',
    '12abc',
    '1_000',
    'true',
    'nil',
    null,
    undefined,
    [],
    {},
    1n,
    () => {},
  ]) {
    assert.throws(
      () => Conversions.num(input),
      typeof input === 'string' && /^[+-]?Infinity$/.test(input) ? RangeError : TypeError,
    );
  }
  assert.throws(() => Conversions.num('1e999'), RangeError);
  assert.equal(Conversions.num(), 0);
  assert.throws(() => Conversions.num(1, 2), TypeError);
  let coerced = false;
  assert.throws(
    () =>
      Conversions.num({
        valueOf() {
          coerced = true;
          return 42;
        },
      }),
    TypeError,
  );
  assert.equal(coerced, false);
});

test('string formats primitives without coercing collections or executing host hooks', () => {
  for (const [input, expected] of [
    [null, 'nil'],
    [undefined, 'nil'],
    [true, 'true'],
    [false, 'false'],
    [42, '42'],
    [-0, '-0'],
    [' hello ', ' hello '],
  ]) {
    assert.equal(Conversions.str(input), expected);
  }
  for (const input of [
    NaN,
    Infinity,
    -Infinity,
    Bindings.list(),
    Bindings.dict(),
    Bindings.vec2f(1),
    Bindings.mat2x2f(1, 0, 0, 1),
    [],
    {},
    1n,
    () => {},
  ]) {
    assert.throws(() => Conversions.str(input), TypeError);
  }
  let coerced = false;
  assert.throws(
    () =>
      Conversions.str({
        toString() {
          coerced = true;
          return 'surprise';
        },
      }),
    TypeError,
  );
  assert.equal(coerced, false);
  assert.equal(Conversions.str(), '');
  assert.throws(() => Conversions.str(1, 2), TypeError);
});

test('conversions work as first-class Lisp bindings with traces and unchanged assertions', () => {
  for (const trace of [true, false]) {
    let calls = 0;
    const evaluate = (source) =>
      Compiler.run(
        Compiler.compile(
          source,
          {
            ...Bindings,
            next: () => {
              calls++;
              return '42.5';
            },
          },
          Forms,
          { trace },
        ),
      );
    assert.equal(evaluate('(num (next))'), 42.5);
    assert.equal(calls, 1);
    assert.equal(evaluate('(str nil)'), 'nil');
    assert.equal(evaluate('(let convert num) (convert)'), 0);
    assert.equal(evaluate('(let convert str) (convert)'), '');
    assert.equal(evaluate('$"value {(str (num "42"))}"'), 'value 42');
    assert.equal(evaluate('((num "42") : num)'), 42);
    assert.throws(() => evaluate('("42" : num)'), TypeError);
    assert.throws(() => evaluate('(42 : str)'), TypeError);
    for (const source of ['(num nil)', '(num "")', '(str (list))', '(str 1 2)']) {
      assert.throws(
        () => evaluate(source),
        (error) => error instanceof TypeError && (!trace || Boolean(error.lisp)),
        source,
      );
    }
  }
});

test('shader f32 conversions preserve scalars and map booleans to zero and one', () => {
  const source = '(sh (input:f32) (let enabled (bool input)) (return (vec4f (f32 enabled) (f32 (bool)) (f32) 1)))';
  const result = Shader.compileShader(Compiler.read(source)[0], source);
  assert.match(result.wgsl, /select\(0.0f, 1.0f, local\d+\)/);
  assert.match(result.wgsl, /select\(0.0f, 1.0f, false\)/);
  for (const expression of [
    '(f32 1 2)',
    '(f32 (vec2f 1))',
    '(f32 nil)',
    '(f32 "42")',
    '(str true)',
  ]) {
    assert.throws(
      () => Compiler.compile(`(sh () (return (vec4f ${expression})))`, {}, Forms),
      SyntaxError,
    );
  }
});
