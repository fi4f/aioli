import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, read } from '../engine/compiler.js';
import { bindings } from '../engine/bindings.js';
import { forms } from '../engine/forms.js';
import { list, dict, get, put } from '../engine/data.js';
import { assertType } from '../engine/types.js';

test('nil is the reserved null-backed sentinel and supports annotations and JSON', () => {
  assert.equal(read('nil')[0].value, null);
  for (const trace of [true, false]) {
    const evaluate = source => compile(source, bindings, forms, { trace }).run();
    for (const source of ['nil', '(nil : nil)', '(from-json "null")', '((fn (value:nil) (return value)) nil)']) {
      assert.equal(evaluate(source), null);
    }
    assert.equal(evaluate('(to-json nil)'), 'null');
    assert.equal(evaluate('(= nil (from-json (to-json nil)))'), true);
    assert.equal(evaluate('(get (list nil) 0)'), null);
    assert.equal(evaluate('(in nil (list nil))'), true);
    assert.equal(evaluate('(in "key" (dict "key" nil))'), true);
    assert.equal(evaluate('(in "key" (dict))'), false);
    assert.throws(() => evaluate('(let nil 1)'), SyntaxError);
    assert.throws(() => evaluate('(fn (nil))'), SyntaxError);
    assert.throws(() => evaluate('(nil)'), error => error instanceof TypeError && (!trace || /nil/.test(error.message)));
    assert.throws(() => evaluate('(nil : num)'), /received nil/);
    assert.throws(() => evaluate('(sh () (return (vec4f nil)))'), SyntaxError);
  }
  assert.equal(assertType(null, 'nil'), null);
  assert.throws(() => assertType(false, 'nil'), TypeError);
});

test('all language no-value paths produce nil, including host interop and missing arguments', () => {
  for (const trace of [true, false]) {
    const evaluate = source => compile(source, { ...bindings, missing: undefined, nothing() {}, identity: value => value }, forms, { trace }).run();
    for (const source of [
      '', '{}', '(let value 1)', '(if false {})', '((fn ()))', '((fn () 42))',
      '((fn () (return)))', '((fn (value) (return value)))', 'missing', '(nothing)',
      '(identity (nothing))', '(get (dict) "missing")', '(dict).missing',
      '((fn () (return (if false 42))))',
    ]) assert.equal(evaluate(source), null, source);
    assert.equal(evaluate('((fn (value:nil) (return value)))'), null);
    assert.equal(evaluate('(= (nothing) nil)'), true);
  }
  const values = list(undefined);
  assert.equal(get(values, 0), null);
  put(values, 0, undefined);
  assert.equal(values.values[0], null);
  const object = dict('key', undefined);
  assert.equal(object.values.key, null);
  put(object, 'other', undefined);
  assert.equal(object.values.other, null);
});
