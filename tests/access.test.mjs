import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, read } from '../engine/compiler.js';
import { forms } from '../engine/forms.js';
import { bindings } from '../engine/bindings.js';
import { dict, list } from '../engine/data.js';

test('dot access chains through nested lists, dicts, vectors, and expression results', () => {
  for (const trace of [true, false]) {
    let calls = 0;
    const root = dict('players', list(dict('profile', dict('first name', 'Shawn'),
      'position', bindings.vec3f(1, 2, 3))));
    const evaluate = source => compile(source, { ...bindings, root, next: () => { calls++; return root; } }, forms, { trace }).run();
    assert.equal(evaluate('root.players.0.profile."first name"'), 'Shawn');
    assert.equal(evaluate('(next).players.0.position.z'), 3);
    assert.equal(calls, 1);
    assert.deepEqual(evaluate('root.players.0.position.zyx').values, [3, 2, 1]);
    assert.equal(evaluate('(list (list 1 2)).0.1'), 2);
    assert.equal(evaluate('f"Hello {root.players.0.profile."first name"}!"'), 'Hello Shawn!');
    assert.equal(evaluate('(root.players.0.profile."first name" : str)'), 'Shawn');
    assert.equal(evaluate('(put root.players.0.profile "first name" "Alex") root.players.0.profile."first name"'), 'Alex');
    assert.equal(evaluate('(let alias root.players.0.position) (put alias 0 42) root.players.0.position.x'), 42);
  }
});

test('dict dot keys are literal text and quoted keys handle punctuation and escapes', () => {
  for (const trace of [true, false]) {
    const object = dict('key', 'literal', 'other', 'dynamic', '42', 'numeric', '01', 'leading zero',
      'x', 'dict x', 'xy', 'dict xy', 'xxxxx', 5, '__proto__', 6, 'constructor', 7,
      'a.b', 8, '', 9, 'quote"key', 10, 'line\nkey', 11, 'first-name', 12, 'true', 13);
    const evaluate = source => compile(source, { ...bindings, object }, forms, { trace }).run();
    assert.equal(evaluate('(let key "other") object.key'), 'literal');
    assert.equal(evaluate('(let key "other") (get object key)'), 'dynamic');
    assert.equal(evaluate('object.42'), 'numeric');
    assert.equal(evaluate('object.01'), 'leading zero');
    assert.equal(evaluate('object.x'), 'dict x');
    assert.equal(evaluate('object.xy'), 'dict xy');
    assert.equal(evaluate('object.xxxxx'), 5);
    assert.equal(evaluate('object.__proto__'), 6);
    assert.equal(evaluate('object.constructor'), 7);
    assert.equal(evaluate('object."a.b"'), 8);
    assert.equal(evaluate('object.""'), 9);
    assert.equal(evaluate('object."quote\\"key"'), 10);
    assert.equal(evaluate('object."line\\nkey"'), 11);
    assert.equal(evaluate('object.first-name'), 12);
    assert.equal(evaluate('object.true'), 13);
    assert.equal(evaluate('object.missing'), null);
    assert.equal(evaluate('(let callbacks (dict "add" (fn (x) (return (+ x 1))))) (callbacks.add 2)'), 3);
  }
});

test('list indices are checked and dot access never exposes host properties', () => {
  for (const trace of [true, false]) {
    const evaluate = source => compile(source, { ...bindings, host: { name: 'private' } }, forms, { trace }).run();
    for (const source of ['(list 1).-1', '(list 1).1', '(list 1).9007199254740993']) {
      assert.throws(() => evaluate(source), error => error instanceof RangeError && (!trace || Boolean(error.lisp)), source);
    }
    for (const source of ['(list 1)."0"', '(list 1).name', 'host.name', '"abc".length', '(vec2f 1)."x"', '(dict).missing.name']) {
      assert.throws(() => evaluate(source), error => error instanceof TypeError && (!trace || Boolean(error.lisp)), source);
    }
    assert.equal(evaluate('(list 1 2).01'), 2);
  }
  const source = '(let root (dict "items" (list 1)))\nroot.items.8.name';
  assert.throws(() => compile(source, bindings, forms).run(), error => {
    assert.equal(source.slice(error.lisp.start, error.lisp.end), 'root.items.8');
    return true;
  });
});

test('reader preserves keys and nested spans and rejects incomplete quoted dot access', () => {
  const source = 'root.players.0."first name"';
  const node = read(source)[0];
  assert.equal(node.kind, 'access');
  assert.equal(node.key, 'first name');
  assert.equal(node.quoted, true);
  assert.equal(node.target.key, '0');
  assert.equal(node.target.quoted, false);
  assert.equal(node.target.target.key, 'players');
  assert.equal(source.slice(node.start, node.end), source);
  for (const source of ['root.', 'root..name', 'root."unterminated', 'root."bad\\q"', 'root. name']) {
    assert.throws(() => read(source), error => error instanceof SyntaxError && Boolean(error.lisp), source);
  }
});

test('shader dot access remains restricted to valid vector swizzles', () => {
  for (const selector of ['name', '0', '"x"', 'xxxxx', 'xzq']) {
    const source = `(sh () (return (vec4f 1).${selector}))`;
    assert.throws(() => compile(source, {}, forms), error => error instanceof SyntaxError && Boolean(error.lisp));
  }
});
