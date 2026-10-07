import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, read } from '../engine/compiler/compiler.js';
import { forms } from '../engine/compiler/forms.js';
import { bindings } from '../engine/language/bindings.js';
import { compileShader } from '../engine/compiler/shader.js';

test('logical forms preserve boolean behavior and empty and unary identities', () => {
  for (const trace of [true, false]) {
    const evaluate = source => compile(source, bindings, forms, { trace }).run();
    for (const [source, expected] of [
      ['(and)', true], ['(or)', false], ['(and true)', true], ['(or false)', false],
      ['(and true true false)', false], ['(or false false true)', true],
      ['(not true)', false], ['(not false)', true], ['(not (or false (and true false)))', true],
    ]) assert.equal(evaluate(source), expected);
    assert.equal(evaluate('((fn () (if (and (in 2 (list 1 2)) (not false)) { (return "yes") }) (return "no")))'), 'yes');
  }
});

test('and and or evaluate operands once in order and skip unselected operands', () => {
  for (const trace of [true, false]) {
    const events = [];
    const evaluate = source => compile(source, {
      ...bindings, record: value => { events.push(value); return value; },
      fail: () => { throw new Error('should be skipped'); },
    }, forms, { trace }).run();
    assert.equal(evaluate('(and (record true) (record false) (fail))'), false);
    assert.deepEqual(events, [true, false]);
    events.length = 0;
    assert.equal(evaluate('(or (record false) (record true) (fail))'), true);
    assert.deepEqual(events, [false, true]);
    assert.equal(evaluate('(and false 42)'), false);
    assert.equal(evaluate('(or true "skipped")'), true);
    assert.equal(evaluate('(and 1)'), 1);
    assert.equal(evaluate('(or "yes")'), 'yes');
    assert.equal(evaluate('(and true 1)'), 1);
    assert.equal(evaluate('(or false 1)'), 1);
    for (const source of ['(not 0)', '(not nil)']) {
      assert.throws(() => evaluate(source), error => error instanceof TypeError && (!trace || Boolean(error.lisp)), source);
    }
    for (const source of ['(not)', '(not true false)', '(and (let value true))', '(fn (or))']) {
      assert.throws(() => evaluate(source), error => error instanceof SyntaxError && Boolean(error.lisp), source);
    }
  }
  const source = '(and true\n (not 42))';
  assert.throws(() => compile(source, bindings, forms).run(), error => {
    assert.equal(source.slice(error.lisp.start, error.lisp.end), '42');
    return true;
  });
});

test('fast selectors use language truthiness and not retains boolean type checks', () => {
  const program = compile('(and true (not false))', {}, forms, { trace: false });
  assert.match(program.javascript, /\$bool/);
  assert.match(program.javascript, /\$assert/);
  assert.doesNotMatch(program.javascript, /\$trace|=>/);
  assert.equal(program.run(), true);
});

test('shader logical forms support boolean locals, uniforms, helper parameters and returns', () => {
  const source = `(sh (enabled:bool)
    (let gate (fn (a:bool b:bool) (return (and a (not b)))))
    (let result (gate enabled false))
    (set result (or result (and)))
    (let copied (copy (result : bool)))
    (return (vec4f (% 7 3) 0 0 1)))`;
  const result = compileShader(read(source)[0], source);
  assert.deepEqual(result.uniforms, [{ name: 'enabled', type: 'bool', slot: 0 }]);
  assert.match(result.wgsl, /frame.values\[0\].x != 0u/);
  assert.match(result.wgsl, /argument0: bool, argument1: bool\) -> bool/);
  assert.match(result.wgsl, /var local\d+: bool/);
  assert.match(result.wgsl, /&&/);
  assert.match(result.wgsl, /\|\|/);
  assert.match(result.wgsl, /\(7f % 3f\)/);
  for (const body of [
    '(let result (and true 1))', '(let result (or true 1))', '(let result (not 0))',
    '(let result (not))', '(let result (not true false))', '(let result (+ true 1))',
    '(let result true) (set result 1)', '(let result (vec2f true))',
  ]) {
    const source = `(sh () ${body} (return (vec4f 1)))`;
    assert.throws(() => compileShader(read(source)[0], source), error => error instanceof SyntaxError && Boolean(error.lisp), body);
  }
});
