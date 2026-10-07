import { test } from 'node:test';
import assert from 'node:assert/strict';
import { num, f32, str } from '../engine/conversions.js';
import { compile, read } from '../engine/compiler.js';
import { bindings } from '../engine/bindings.js';
import { forms } from '../engine/forms.js';
import { compileShader } from '../engine/shader.js';

test('num converts booleans and complete decimal strings without narrowing numeric precision', () => {
  for (const [input, expected] of [
    [42, 42], [1.23456789012345, 1.23456789012345], [-0, -0], [NaN, NaN], [Infinity, Infinity],
    [true, 1], [false, 0], ['42', 42], [' -0 ', -0], ['.5', 0.5], ['1.', 1],
    ['-1.25e+2', -125], ['NaN', NaN], ['Infinity', Infinity], ['+Infinity', Infinity], ['-Infinity', -Infinity],
  ]) assert.ok(Object.is(num(input), expected), String(input));
  for (const input of ['', ' ', '12abc', '0x10', '0b10', '1_000', 'true', 'nil', null, undefined, [], {}, 1n, () => {}]) {
    assert.throws(() => num(input), TypeError);
  }
  assert.throws(() => num('1e999'), RangeError);
  assert.throws(() => num(), TypeError);
  assert.throws(() => num(1, 2), TypeError);
  let coerced = false;
  assert.throws(() => num({ valueOf() { coerced = true; return 42; } }), TypeError);
  assert.equal(coerced, false);
});

test('string formats primitives without coercing collections or executing host hooks', () => {
  for (const [input, expected] of [[null, 'nil'], [undefined, 'nil'], [true, 'true'], [false, 'false'],
    [42, '42'], [-0, '-0'], [NaN, 'NaN'], [Infinity, 'Infinity'], [-Infinity, '-Infinity'], [' hello ', ' hello ']]) {
    assert.equal(str(input), expected);
  }
  for (const input of [bindings.list(), bindings.dict(), bindings.vec2f(1), bindings.mat2x2f(1, 0, 0, 1), [], {}, 1n, () => {}]) {
    assert.throws(() => str(input), TypeError);
  }
  let coerced = false;
  assert.throws(() => str({ toString() { coerced = true; return 'surprise'; } }), TypeError);
  assert.equal(coerced, false);
  assert.throws(() => str(), TypeError);
  assert.throws(() => str(1, 2), TypeError);
});

test('conversions work as first-class Lisp bindings with traces and unchanged assertions', () => {
  for (const trace of [true, false]) {
    let calls = 0;
    const evaluate = source => compile(source, { ...bindings, next: () => { calls++; return '42.5'; } }, forms, { trace }).run();
    assert.equal(evaluate('(num (next))'), 42.5);
    assert.equal(calls, 1);
    assert.equal(evaluate('(str nil)'), 'nil');
    assert.equal(evaluate('(let convert num) (convert "12")'), 12);
    assert.equal(evaluate('(let convert str) (convert (num true))'), '1');
    assert.equal(evaluate('f"value {(str (num "42"))}"'), 'value 42');
    assert.equal(evaluate('((num "42") : num)'), 42);
    assert.throws(() => evaluate('("42" : num)'), TypeError);
    assert.throws(() => evaluate('(42 : str)'), TypeError);
    for (const source of ['(num nil)', '(num "")', '(str (list))', '(num)', '(str 1 2)']) {
      assert.throws(() => evaluate(source), error => error instanceof TypeError && (!trace || Boolean(error.lisp)), source);
    }
  }
});

test('shader f32 conversions preserve scalars and map booleans to zero and one', () => {
  const source = '(sh (enabled:bool) (return (vec4f (f32 enabled) (f32 false) (f32 0.5) 1)))';
  const result = compileShader(read(source)[0], source);
  assert.match(result.wgsl, /select\(0.0f, 1.0f, \(frame.values\[0\].x != 0u\)\)/);
  assert.match(result.wgsl, /select\(0.0f, 1.0f, false\)/);
  for (const expression of ['(f32)', '(f32 1 2)', '(f32 (vec2f 1))', '(f32 nil)', '(f32 "42")', '(str true)']) {
    assert.throws(() => compile(`(sh () (return (vec4f ${expression})))`, {}, forms), SyntaxError);
  }
});
