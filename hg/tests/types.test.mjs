import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Compiler } from "../compiler.js";
import { Forms } from "../forms.js";
import { Arithmetic } from "../arithmetic.js";
import { Types } from "../types.js";
import { Trace } from "../trace.js";
import { Data } from "../data.js";

test('num is the generic regular-code numeric type and number is not an alias', () => {
  assert.equal(Types.assertType(42, 'num'), 42);
  assert.throws(() => Types.assertType(42, 'number'), /Unknown type/);
  for (const source of ['(42 : number)', '(fn (value:number))', '(sh (value:f32ber) (return (vec4f 1)))']) {
    assert.throws(() => Compiler.compile(source, {}, Forms), SyntaxError);
  }
  assert.equal(Compiler.run(Compiler.compile('((fn (value:num) (return (+ value 0.5))) 1)', Arithmetic.bindings, Forms)), 1.5);
});

test('scene functions accept mixed typed and untyped parameters in both modes', () => {
  for (const trace of [true, false]) {
    const source = '(let identity (fn (value : num ignored) (return value))) (identity 42 "anything")';
    const program = Compiler.compile(source, {}, Forms, { trace });
    assert.equal(Compiler.run(program), 42);
    assert.match(program.javascript, /\$assert/);
    if (!trace) assert.doesNotMatch(program.javascript, /\$trace/);
    assert.throws(() => Compiler.run(Compiler.compile('((fn (value:num) (return value)) NaN)', {}, Forms, { trace })), SyntaxError);
  }
});

test('typed parameters reject mismatches before executing the body and include Lisp locations', () => {
  let executed = false;
  const source = '(let f (fn (value : num) (mark)))\n(f "2")';
  assert.throws(() => Compiler.run(Compiler.compile(source, { mark: () => { executed = true; } }, Forms)), error => {
    assert.match(Trace.formatTrace(error), /Parameter value: expected num, received str "2"/);
    assert.equal(source.slice(error.lisp.start, error.lisp.end), 'value : num');
    return true;
  });
  assert.equal(executed, false);
  assert.throws(() => Compiler.run(Compiler.compile('((fn (value:num) (return value)))', {}, Forms)), /received nil/);
});

test('explicit colon expressions assert values once without conversion', () => {
  let calls = 0;
  const result = Compiler.run(Compiler.compile('((next) : num)', { next: () => { calls++; return 42; } }, Forms));
  assert.equal(result, 42); assert.equal(calls, 1);
  assert.throws(() => Compiler.run(Compiler.compile('("2" : num)', {}, Forms)), TypeError);
  assert.throws(() => Compiler.compile('(1 : bogus)', {}, Forms), SyntaxError);
  assert.throws(() => Compiler.compile('(1 : num extra)', {}, Forms), SyntaxError);
});

test('primitive assertions do not coerce and vectors validate shape/components', () => {
  assert.throws(() => Types.assertType(Infinity, 'num'), TypeError);
  assert.throws(() => Types.assertType(NaN, 'num'), TypeError);
  assert.equal(Types.assertType(false, 'bool'), false);
  assert.equal(Types.assertType('hello', 'str'), 'hello');
  assert.equal(Types.assertType(Math.sin, 'function'), Math.sin);
  const uv = Types.vectorBindings.vec2f(0.1, 0.2);
  assert.equal(Types.assertType(uv, 'vec2f'), uv);
  for (const value of ['2', true, null, undefined, 2n, {}, { valueOf: () => 2 }]) assert.throws(() => Types.assertType(value, 'num'), TypeError);
  for (const value of [[1, '2'], [1], [1, 2], [1, 2, 3], new Float32Array([1, 2]), new DataView(new ArrayBuffer(8))]) assert.throws(() => Types.assertType(value, 'vec2f'), TypeError);
  assert.throws(() => Types.assertType({ texture: {} }, 'texture2d'), TypeError);
});

test('scene vectors can feed typed function parameters', () => {
  assert.deepEqual(Data.values(Types.vectorBindings.vec4f(Types.vectorBindings.vec2f(1, 2), 3, 4)), [1, 2, 3, 4]);
  assert.deepEqual(Data.values(Types.vectorBindings.vec3f(2)), [2, 2, 2]);
  assert.deepEqual(Compiler.run(Compiler.compile('((fn (uv:vec2f) (return uv)) (vec2f 1 2))', Types.vectorBindings, Forms)), Types.vectorBindings.vec2f(1, 2));
  assert.throws(() => Types.vectorBindings.vec2f('2', 3), TypeError);
});

test('vector assertions and swizzle reads still validate every mutable component', () => {
  for (const [type, invalid] of [['vec4f', 0.1], ['vec4i', 1.5], ['vec4u', -1]]) {
    const value = Types.vectorBindings[type](1, 2, 3, 4);
    for (const component of [invalid, NaN, Infinity, '4', undefined]) {
      value.w = component;
      assert.throws(() => Types.assertType(value, type), TypeError);
      assert.throws(() => Types.swizzle(value, 'x'), TypeError);
    }
    value.w = 4;
    assert.equal(Types.swizzle(value, 'x'), 1);
  }
  const matrix = Data.matrix(2, [1, 2, 3, 4]);
  const column = Data.matrixColumn(matrix, 0);
  assert.equal(Types.assertType(column, 'vec2f'), column);
  matrix.values[1] = NaN;
  assert.throws(() => Types.assertType(column, 'vec2f'), TypeError);
});

test('typed lifecycle callbacks count declarations rather than annotation tokens', () => {
  const seen = [];
  const scene = Compiler.run(Compiler.compileScene('(on update (context : dict) (record context.dt))', { record: dt => seen.push(dt) }, Forms, {  }));
  scene.update(Data.dict('dt', 1 / 60));
  assert.deepEqual(seen, [1 / 60]);
  assert.throws(() => scene.update('0.1'), TypeError);
  for (const parameters of ['value:', 'value::num', ':num', 'value:constructor', 'value:num value']) {
    assert.throws(() => Compiler.compile(`(fn (${parameters}) (return 1))`, {}, Forms), SyntaxError);
  }
});
