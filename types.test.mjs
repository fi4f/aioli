import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './compiler.js';
import { forms } from './forms.js';
import { arithmetic } from './arithmetic.js';
import { assertType, vectorBindings } from './types.js';
import { formatDiagnostic } from './diagnostics.js';

test('scene functions accept mixed typed and untyped parameters in both modes', () => {
  for (const debug of [true, false]) {
    const source = '(let identity (fn (value : number ignored) (return value))) (identity 42 "anything")';
    const program = compile(source, {}, forms, { debug });
    assert.equal(program.run(), 42);
    assert.match(program.javascript, /\$assert/);
    if (!debug) assert.doesNotMatch(program.javascript, /\$debug/);
    assert.ok(Number.isNaN(compile('((fn (value:float) (return value)) NaN)', {}, forms, { debug }).run()));
  }
});

test('typed parameters reject mismatches before executing the body and include Lisp locations', () => {
  let executed = false;
  const source = '(let f (fn (value : number) (mark)))\n(f "2")';
  assert.throws(() => compile(source, { mark: () => { executed = true; } }, forms).run(), error => {
    assert.match(formatDiagnostic(error), /Parameter value: expected number, received string "2"/);
    assert.equal(source.slice(error.lisp.start, error.lisp.end), 'value : number');
    return true;
  });
  assert.equal(executed, false);
  assert.throws(() => compile('((fn (value:number) (return value)))', {}, forms).run(), /received undefined/);
});

test('explicit colon expressions assert values once without conversion', () => {
  let calls = 0;
  const result = compile('((next) : number)', { next: () => { calls++; return 42; } }, forms).run();
  assert.equal(result, 42); assert.equal(calls, 1);
  assert.throws(() => compile('("2" : number)', {}, forms).run(), TypeError);
  assert.throws(() => compile('(1 : bogus)', {}, forms), SyntaxError);
  assert.throws(() => compile('(1 : number extra)', {}, forms), SyntaxError);
});

test('primitive assertions do not coerce and vectors validate shape/components', () => {
  assert.equal(assertType(Infinity, 'number'), Infinity);
  assert.ok(Number.isNaN(assertType(NaN, 'float')));
  assert.equal(assertType(false, 'boolean'), false);
  assert.equal(assertType('hello', 'string'), 'hello');
  assert.equal(assertType(Math.sin, 'function'), Math.sin);
  const uv = new Float32Array([0.1, 0.2]);
  assert.equal(assertType(uv, 'vec2'), uv);
  for (const value of ['2', true, null, undefined, 2n, {}, { valueOf: () => 2 }]) assert.throws(() => assertType(value, 'number'), TypeError);
  for (const value of [[1, '2'], [1], [1, 2, 3], new DataView(new ArrayBuffer(8))]) assert.throws(() => assertType(value, 'vec2'), TypeError);
  assert.throws(() => assertType({ texture: {} }, 'texture2d'), TypeError);
});

test('scene vectors can feed typed function parameters', () => {
  assert.deepEqual(vectorBindings.vec4(vectorBindings.vec2(1, 2), 3, 4), [1, 2, 3, 4]);
  assert.deepEqual(vectorBindings.vec3(2), [2, 2, 2]);
  assert.deepEqual(compile('((fn (uv:vec2) (return uv)) (vec2 1 2))', vectorBindings, forms).run(), [1, 2]);
  assert.throws(() => vectorBindings.vec2('2', 3), TypeError);
});

test('typed lifecycle callbacks count declarations rather than annotation tokens', () => {
  const seen = [];
  const scene = compile('(on update (dt : number) (record dt))', { record: dt => seen.push(dt) }, forms, { scene: true }).run();
  scene.update(1 / 60);
  assert.deepEqual(seen, [1 / 60]);
  assert.throws(() => scene.update('0.1'), TypeError);
  for (const parameters of ['value:', 'value::number', ':number', 'value:constructor', 'value:number value']) {
    assert.throws(() => compile(`(fn (${parameters}) (return 1))`, {}, forms), SyntaxError);
  }
});
