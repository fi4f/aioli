import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, read } from '../engine/compiler.js';
import { forms } from '../engine/forms.js';
import { bindings } from '../engine/bindings.js';
import { compileShader } from '../engine/shader.js';

test('truthiness checks explicit empty and zero values while retaining nonempty data', () => {
  for (const trace of [true, false]) {
    const evaluate = source => compile(source, bindings, forms, { trace }).run();
    for (const expression of ['nil', 'false', '0', '-0', 'NaN', '""', '(list)', '(dict)']) {
      assert.equal(evaluate(`(bool ${expression})`), false, expression);
      assert.equal(evaluate(`((fn () (return (if ${expression} "yes" "no"))))`), 'no', expression);
      assert.equal(evaluate(`(let result nil) (if ${expression} { (set result true) } else { (set result false) }) result`), false, expression);
    }
    for (const expression of ['true', '1', '-1', 'Infinity', '-Infinity', '"0"', '"false"', '" "', '(list nil)', '(dict "key" nil)', '(vec2f 0)', '(mat2x2f)', '(fn ())']) {
      assert.equal(evaluate(`(bool ${expression})`), true, expression);
      assert.equal(evaluate(`((fn () (return (if ${expression} "yes" "no"))))`), 'yes', expression);
    }
    assert.equal(evaluate('(let result nil) (if (list) {} elif (dict) {} elif (list nil) { (set result 42) }) result'), 42);
    assert.equal(evaluate('(and (bool (list 1)) (not (bool nil)))'), true);
    assert.equal(evaluate('(and (list 1) true)'), true);
    assert.throws(() => evaluate('(not nil)'), TypeError);
    assert.throws(() => evaluate('(bool)'), TypeError);
    assert.throws(() => evaluate('(bool 1 2)'), TypeError);
  }
});

test('truthiness follows mutation, evaluates once, and uses internal rules independently of bindings', () => {
  for (const trace of [true, false]) {
    let calls = 0;
    const evaluate = source => compile(source, {
      ...bindings, next: () => { calls++; return bindings.list(); },
    }, forms, { trace }).run();
    assert.equal(evaluate('(if (next) {} else {})'), null);
    assert.equal(calls, 1);
    assert.equal(evaluate('(bool (next))'), false);
    assert.equal(calls, 2);
    assert.equal(evaluate('(let value (dict)) (put value "key" nil) (bool value)'), true);
    assert.equal(compile('(let bool (fn () (return true))) ((fn () (return (if (dict) 1 2))))', bindings, forms, { trace }).run(), 2);
  }
});

test('shader truthiness supports booleans, zero numeric scalars, and nonempty numeric aggregates', () => {
  const source = `(sh (value:f32)
    (let zero (bool value))
    (let flag (bool false))
    (let vector (bool (vec2f 0)))
    (let matrix (bool (mat2x2f)))
    (let result (and zero (not flag) vector matrix))
    (return (vec4f 1)))`;
  const result = compileShader(read(source)[0], source);
  assert.match(result.wgsl, /bool1\(bitcast<f32>\(frame.values\[0\].x\)\)/);
  assert.match(result.wgsl, /value == value.*value != 0.0f/);
  assert.match(result.wgsl, /fn bool2\(value: vec2f\) -> bool/);
  assert.match(result.wgsl, /fn boolmat2x2f\(value: mat2x2f\) -> bool/);
  for (const expression of ['(bool)', '(bool 1 2)', '(bool nil)']) {
    assert.throws(() => compile(`(sh () (let result ${expression}) (return (vec4f 1)))`, {}, forms), SyntaxError);
  }
});
