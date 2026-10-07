import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../engine/compiler.js';
import { forms } from '../engine/forms.js';
import { arithmetic } from '../engine/arithmetic.js';
import { assertType, vectorBindings } from '../engine/types.js';
import { formatTrace } from '../engine/trace.js';
import { dict } from '../engine/data.js';

test('num is the generic regular-code numeric type and number is not an alias', () => {
  assert.equal(assertType(42, 'num'), 42);
  assert.throws(() => assertType(42, 'number'), /Unknown type/);
  for (const source of ['(42 : number)', '(fn (value:number))', '(sh (value:f32ber) (return (vec4f 1)))']) {
    assert.throws(() => compile(source, {}, forms), SyntaxError);
  }
  assert.equal(compile('((fn (value:num) (return (+ value 0.5))) 1)', arithmetic, forms).run(), 1.5);
});

test('scene functions accept mixed typed and untyped parameters in both modes', () => {
  for (const trace of [true, false]) {
    const source = '(let identity (fn (value : num ignored) (return value))) (identity 42 "anything")';
    const program = compile(source, {}, forms, { trace });
    assert.equal(program.run(), 42);
    assert.match(program.javascript, /\$assert/);
    if (!trace) assert.doesNotMatch(program.javascript, /\$trace/);
    assert.ok(Number.isNaN(compile('((fn (value:num) (return value)) NaN)', {}, forms, { trace }).run()));
  }
});

test('typed parameters reject mismatches before executing the body and include Lisp locations', () => {
  let executed = false;
  const source = '(let f (fn (value : num) (mark)))\n(f "2")';
  assert.throws(() => compile(source, { mark: () => { executed = true; } }, forms).run(), error => {
    assert.match(formatTrace(error), /Parameter value: expected num, received str "2"/);
    assert.equal(source.slice(error.lisp.start, error.lisp.end), 'value : num');
    return true;
  });
  assert.equal(executed, false);
  assert.throws(() => compile('((fn (value:num) (return value)))', {}, forms).run(), /received nil/);
});

test('explicit colon expressions assert values once without conversion', () => {
  let calls = 0;
  const result = compile('((next) : num)', { next: () => { calls++; return 42; } }, forms).run();
  assert.equal(result, 42); assert.equal(calls, 1);
  assert.throws(() => compile('("2" : num)', {}, forms).run(), TypeError);
  assert.throws(() => compile('(1 : bogus)', {}, forms), SyntaxError);
  assert.throws(() => compile('(1 : num extra)', {}, forms), SyntaxError);
});

test('primitive assertions do not coerce and vectors validate shape/components', () => {
  assert.equal(assertType(Infinity, 'num'), Infinity);
  assert.ok(Number.isNaN(assertType(NaN, 'num')));
  assert.equal(assertType(false, 'bool'), false);
  assert.equal(assertType('hello', 'str'), 'hello');
  assert.equal(assertType(Math.sin, 'function'), Math.sin);
  const uv = vectorBindings.vec2f(0.1, 0.2);
  assert.equal(assertType(uv, 'vec2f'), uv);
  for (const value of ['2', true, null, undefined, 2n, {}, { valueOf: () => 2 }]) assert.throws(() => assertType(value, 'num'), TypeError);
  for (const value of [[1, '2'], [1], [1, 2], [1, 2, 3], new Float32Array([1, 2]), new DataView(new ArrayBuffer(8))]) assert.throws(() => assertType(value, 'vec2f'), TypeError);
  assert.throws(() => assertType({ texture: {} }, 'texture2d'), TypeError);
});

test('scene vectors can feed typed function parameters', () => {
  assert.deepEqual(vectorBindings.vec4f(vectorBindings.vec2f(1, 2), 3, 4).values, [1, 2, 3, 4]);
  assert.deepEqual(vectorBindings.vec3f(2).values, [2, 2, 2]);
  assert.deepEqual(compile('((fn (uv:vec2f) (return uv)) (vec2f 1 2))', vectorBindings, forms).run(), vectorBindings.vec2f(1, 2));
  assert.throws(() => vectorBindings.vec2f('2', 3), TypeError);
});

test('typed lifecycle callbacks count declarations rather than annotation tokens', () => {
  const seen = [];
  const scene = compile('(on update (context : dict) (record context.dt))', { record: dt => seen.push(dt) }, forms, { scene: true }).run();
  scene.update(dict('dt', 1 / 60));
  assert.deepEqual(seen, [1 / 60]);
  assert.throws(() => scene.update('0.1'), TypeError);
  for (const parameters of ['value:', 'value::num', ':num', 'value:constructor', 'value:num value']) {
    assert.throws(() => compile(`(fn (${parameters}) (return 1))`, {}, forms), SyntaxError);
  }
});
