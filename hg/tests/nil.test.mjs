import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Compiler } from '../compiler.js';
import { Bindings } from '../bindings.js';
import { Forms } from '../forms.js';
import { Data } from '../data.js';
import { Types } from '../types.js';

test('nil is the reserved null-backed sentinel and supports annotations and JSON', () => {
  assert.equal(Compiler.read('nil')[0].value, null);
  for (const trace of [true, false]) {
    const evaluate = (source) => Compiler.run(Compiler.compile(source, Bindings, Forms, { trace }));
    for (const source of [
      'nil',
      '(nil : nil)',
      '(from-json "null")',
      '((fn (value:nil) (return value)) nil)',
    ]) {
      assert.equal(evaluate(source), null);
    }
    assert.equal(evaluate('(to-json nil)'), 'null');
    assert.equal(evaluate('(= nil (from-json (to-json nil)))'), true);
    assert.equal(evaluate('(get (list nil).0)'), null);
    assert.equal(evaluate('(in nil (list nil))'), true);
    assert.equal(evaluate('(in "key" (dict "key" nil))'), true);
    assert.equal(evaluate('(in "key" (dict))'), false);
    assert.throws(() => evaluate('(let nil 1)'), SyntaxError);
    assert.throws(() => evaluate('(fn (nil))'), SyntaxError);
    assert.equal(evaluate('(nil)'), null);
    assert.throws(() => evaluate('(nil : num)'), /received nil/);
    assert.equal(
      Compiler.compile('(sh () (return (vec4f nil)))', Bindings, Forms, { trace }).shaders.length,
      1,
    );
  }
  assert.equal(Types.assertType(null, 'nil'), null);
  assert.throws(() => Types.assertType(false, 'nil'), TypeError);
});

test('all language no-value paths produce nil, including host interop and missing arguments', () => {
  for (const trace of [true, false]) {
    const evaluate = (source) =>
      Compiler.run(
        Compiler.compile(
          source,
          { ...Bindings, missing: undefined, nothing() {}, identity: (value) => value },
          Forms,
          { trace },
        ),
      );
    for (const source of [
      '',
      '{}',
      '(let value 1)',
      '(if false {})',
      '((fn ()))',
      '((fn () { 42 }))',
      '((fn () (return)))',
      '((fn (value) (return value)))',
      'missing',
      '(nothing)',
      '(identity (nothing))',
      '(get (dict)."missing")',
      '(dict).missing',
      '((fn () (return (if false 42))))',
    ])
      assert.equal(evaluate(source), null, source);
    assert.equal(evaluate('((fn (value:nil) (return value)))'), null);
    assert.equal(evaluate('(= (nothing) nil)'), true);
  }
  const values = Data.list(undefined);
  assert.equal(Data.get(values, 0), null);
  Data.put(values, 0, undefined);
  assert.equal(Data.values(values)[0], null);
  const object = Data.dict('key', undefined);
  assert.equal(Data.values(object).key, null);
  Data.put(object, 'other', undefined);
  assert.equal(Data.values(object).other, null);
});
