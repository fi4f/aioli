import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, read } from '../engine/compiler.js';
import { forms } from '../engine/forms.js';
import { bindings } from '../engine/bindings.js';
import { compileShader } from '../engine/shader.js';

test('and and or select original values using language truthiness', () => {
  for (const trace of [true, false]) {
    const evaluate = source => compile(source, bindings, forms, { trace }).run();
    for (const [source, expected] of [
      ['(or nil "fallback")', 'fallback'], ['(and 42 "result")', 'result'],
      ['(and 0 "skip")', 0], ['(and "" 42)', ''], ['(or 0 -0 "" nil 42)', 42],
      ['(or false 0 "")', ''], ['(and 1 2 nil 3)', null],
      ['(or Infinity "skip")', Infinity], ['(or NaN 42)', 42],
      ['(and NaN 42)', NaN], ['(or)', false], ['(and)', true],
    ]) assert.ok(Object.is(evaluate(source), expected), source);
    const emptyList = bindings.list();
    const emptyDict = bindings.dict();
    const full = bindings.list(1);
    const vector = bindings.vec2f(0);
    const select = source => compile(source, { ...bindings, emptyList, emptyDict, full, vector }, forms, { trace }).run();
    assert.equal(select('(and emptyList 42)'), emptyList);
    assert.equal(select('(and emptyDict 42)'), emptyDict);
    assert.equal(select('(or emptyList emptyDict full)'), full);
    assert.equal(select('(or vector full)'), vector);
    assert.equal(select('(and full vector)'), vector);
    assert.equal(select('(and full)'), full);
    assert.equal(evaluate('((fn () (return (or nil (and 1 2)))))'), 2);
  }
});

test('selectors preserve lazy evaluation, operand order, nested scopes, and traces', () => {
  for (const trace of [true, false]) {
    const events = [];
    const evaluate = source => compile(source, {
      ...bindings, mark: value => { events.push(value); return value; }, fail: () => { throw new Error('failure'); },
    }, forms, { trace }).run();
    assert.equal(evaluate('(or (mark 0) (mark "") (mark 42) (fail))'), 42);
    assert.deepEqual(events, [0, '', 42]);
    events.length = 0;
    assert.equal(evaluate('(and (mark 1) (mark 2) (mark nil) (fail))'), null);
    assert.deepEqual(events, [1, 2, null]);
    assert.equal(evaluate('(let x 1) (or (and (set x 0) (fail)) (set x 2)) x'), 2);
    assert.equal(evaluate('(let x 1) ((fn (x) (return (or x 42))) 0)'), 42);
    assert.equal(evaluate('(let result (or (and 0 (fail)) (and 1 2))) result'), 2);
    assert.throws(() => evaluate('(or nil (fail))'), error => error.message === 'failure' && (!trace || Boolean(error.lisp)));
  }
});

test('shader selectors lift lazy same-type numeric selections with explicit lexical inputs', () => {
  const source = `(sh (gain:f32)
    (let choose (fn (value:f32)
      (let local (+ value 1))
      (return (or value (and local 0.5)))))
    (let first (or 0 gain))
    (let color (or (vec4f first) (vec4f 1)))
    (let transform (and (mat2x2f 1 0 0 1) (mat2x2f 2 0 0 2)))
    (return (* color (choose first))))`;
  const result = compileShader(read(source)[0], source);
  assert.match(result.wgsl, /fn selector\d+\(shaderPixel: vec2f, local\d+: f32/);
  assert.match(result.wgsl, /var selected: f32/);
  assert.match(result.wgsl, /if \(bool1\(selected\)\) \{ return selected; \}/);
  assert.match(result.wgsl, /var selected: vec4f/);
  assert.match(result.wgsl, /var selected: mat2x2f/);
  for (const expression of ['(or true 1)', '(and (vec2f 1) (vec3f 1))', '(or (mat2x2f 1 0 0 1) 1)']) {
    assert.throws(() => compile(`(sh () (let result ${expression}) (return (vec4f 1)))`, {}, forms), /same shader type/);
  }
});
