import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Compiler } from "../compiler.js";
import { Forms } from "../forms.js";
import { Bindings } from "../bindings.js";
import { Shader } from "../shader.js";

test('truthiness checks explicit empty and zero values while retaining nonempty data', () => {
  for (const trace of [true, false]) {
    const evaluate = source => Compiler.run(Compiler.compile(source, Bindings, Forms, { trace }));
    for (const expression of ['nil', 'false', '0', '-0', '""', '(list)', '(dict)']) {
      assert.equal(evaluate(`(bool ${expression})`), false, expression);
      assert.equal(evaluate(`((fn () (return (if ${expression} "yes" "no"))))`), 'no', expression);
      assert.equal(evaluate(`(let result nil) (if ${expression} { (set result true) } else { (set result false) }) result`), false, expression);
    }
    for (const expression of ['true', '1', '-1', '"0"', '"false"', '" "', '(list nil)', '(dict "key" nil)', '(vec2f 0)', '(mat2x2f)', '(fn ())']) {
      assert.equal(evaluate(`(bool ${expression})`), true, expression);
      assert.equal(evaluate(`((fn () (return (if ${expression} "yes" "no"))))`), 'yes', expression);
    }
    assert.equal(evaluate('(let result nil) (if (list) {} elif (dict) {} elif (list nil) { (set result 42) }) result'), 42);
    assert.equal(evaluate('(and (bool (list 1)) (not (bool nil)))'), true);
    assert.equal(evaluate('(and (list 1) true)'), true);
    assert.throws(() => evaluate('(not nil)'), TypeError);
    assert.equal(evaluate('(bool)'), false);
    assert.throws(() => evaluate('(bool 1 2)'), TypeError);
  }
});

test('truthiness follows mutation, evaluates once, and uses internal rules independently of bindings', () => {
  for (const trace of [true, false]) {
    let calls = 0;
    const evaluate = source => Compiler.run(Compiler.compile(source, {
      ...Bindings, next: () => { calls++; return Bindings.list(); },
    }, Forms, { trace }));
    assert.equal(evaluate('(if (next) {} else {})'), null);
    assert.equal(calls, 1);
    assert.equal(evaluate('(bool (next))'), false);
    assert.equal(calls, 2);
    assert.equal(evaluate('(let value (dict)) (put value "key" nil) (bool value)'), true);
    assert.equal(Compiler.run(Compiler.compile('(let bool (fn () (return true))) ((fn () (return (if (dict) 1 2))))', Bindings, Forms, { trace })), 2);
  }
});

test('shader truthiness supports booleans, zero numeric scalars, and nonempty numeric aggregates', () => {
  const source = `(sh (value:f32)
    (let zero (bool value))
    (let flag (bool))
    (let vector (bool (vec2f 0)))
    (let matrix (bool (mat2x2f)))
    (let result (and zero (not flag) vector matrix))
    (return (vec4f 1)))`;
  const result = Shader.compileShader(Compiler.read(source)[0], source);
  assert.match(result.wgsl, /bool1\(bitcast<f32>\(frame.values\[0\].x\)\)/);
  assert.match(result.wgsl, /value == value.*value != 0.0f/);
  assert.match(result.wgsl, /fn bool2\(value: vec2f\) -> bool/);
  assert.match(result.wgsl, /fn boolmat2x2f\(value: mat2x2f\) -> bool/);
  for (const expression of ['(bool 1 2)', '(bool nil)']) {
    assert.throws(() => Compiler.compile(`(sh () (let result ${expression}) (return (vec4f 1)))`, {}, Forms), SyntaxError);
  }
});
