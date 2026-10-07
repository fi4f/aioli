import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../engine/compiler.js';
import { forms } from '../engine/forms.js';
import { bindings } from '../engine/bindings.js';
import { list, dict, get, put, copy, reCopy, equal, serializeData, deserializeData } from '../engine/data.js';
import { assertType, vectorBindings, matrixBindings, registerTexture } from '../engine/types.js';

test('where returns the first structurally equal list index or nil', () => {
  const find = bindings.where;
  assert.equal(find(list(10, 20, 10), 10), 0);
  assert.equal(find(list(10, 20, 20), 20), 1);
  assert.equal(find(list(10, 20), '20'), null);
  assert.equal(find(list(), 1), null);
  assert.equal(find(list(1, null), null), 1);
  assert.equal(find(list(NaN), NaN), 0);
  assert.equal(find(list(0, -0), -0), 1);
  assert.equal(find(list(dict('items', list(1))), dict('items', list(1))), 0);
  assert.equal(find(list(vectorBindings.vec2f(1, 2)), vectorBindings.vec2f(1, 2)), 0);
  const cyclic = list(null); put(cyclic, 0, cyclic);
  assert.equal(find(list(cyclic), reCopy(cyclic)), 0);
  const values = list(1, 2);
  bindings.insert(values, 0, 0);
  assert.equal(find(values, 2), 2);
  bindings.remove(values, 1);
  assert.equal(find(values, 2), 1);
});

test('where searches dict values and preserves empty, numeric, and special keys', () => {
  const find = bindings.where;
  assert.equal(find(dict('first', 42, 'second', 42), 42), 'first');
  assert.equal(find(dict('name', 'Shawn'), 'name'), null);
  assert.equal(find(dict('name', 'Shawn'), 'Shawn'), 'name');
  assert.equal(find(dict('empty', null), null), 'empty');
  assert.equal(find(dict('', 1), 1), '');
  assert.equal(find(dict('42', 1), 1), '42');
  assert.equal(find(dict('__proto__', 1), 1), '__proto__');
  assert.equal(find(dict('nested', list(1, 2)), list(1, 2)), 'nested');
  assert.equal(find(dict(), 1), null);
  assert.equal(find(dict('absent', 2), 1), null);
  for (const value of [list(1), dict('key', 1)]) {
    assert.throws(() => find(), TypeError);
    assert.throws(() => find(1), TypeError);
    assert.throws(() => find(value, 1, 2), TypeError);
  }
  for (const target of [null, [], {}, 'abc', vectorBindings.vec2f(1), matrixBindings.mat2x2f(1, 0, 0, 1)]) {
    assert.throws(() => find(target, 1), TypeError);
  }
});

test('where is a first-class Lisp binding with eager ordered arguments and source traces', () => {
  for (const trace of [true, false]) {
    const events = [];
    const evaluate = source => compile(source, {
      ...bindings, needle: () => { events.push('value'); return 2; },
      values: () => { events.push('collection'); return list(1, 2); },
    }, forms, { trace }).run();
    assert.equal(evaluate('(where (values) (needle))'), 1);
    assert.deepEqual(events, ['collection', 'value']);
    assert.equal(evaluate('(let search where) (search (dict "name" "Shawn") "Shawn")'), 'name');
    assert.equal(evaluate('(let state (dict "items" (list 10 20))) (where state.items 10)'), 0);
    assert.equal(evaluate('(where (list nil) nil)'), 0);
    assert.equal(evaluate('(where (list 1 2) 99)'), null);
    assert.equal(evaluate('(where (dict "a" 1) 99)'), null);
    assert.equal(evaluate('(= (where (list 10) 10) nil)'), false);
    for (const source of ['(where (vec2f 1) 1)', '(where)', '(where (list 1) 1 2)', '(where 1 (list 1))']) {
      assert.throws(() => evaluate(source), error => error instanceof TypeError && (!trace || Boolean(error.lisp)), source);
    }
  }
});

test('insert appends by default or shifts at an optional third index and remove shifts back', () => {
  const values = list(10, 20);
  const alias = values;
  assert.equal(bindings.insert(values, 30), values);
  assert.deepEqual(alias.values, [10, 20, 30]);
  bindings.insert(values, 15, 1);
  bindings.insert(values, 5, 0);
  bindings.insert(values, 40, values.values.length);
  assert.deepEqual(values.values, [5, 10, 15, 20, 30, 40]);
  assert.equal(bindings.remove(values, 2), values);
  assert.deepEqual(values.values, [5, 10, 20, 30, 40]);
  bindings.remove(values, 0);
  bindings.remove(values, values.values.length - 1);
  assert.deepEqual(values.values, [10, 20, 30]);
  const independent = copy(values);
  bindings.insert(independent, 99);
  assert.deepEqual(values.values, [10, 20, 30]);
  const empty = list();
  bindings.insert(empty, undefined);
  assert.deepEqual(empty.values, [null]);
  bindings.remove(empty, 0);
  assert.deepEqual(empty.values, []);
});

test('list insertion and removal validate bounds, arity, and types before mutating', () => {
  const values = list(1, 2);
  for (const at of [-1, 3, 0.5, '1', null, undefined, NaN, Infinity]) {
    assert.throws(() => bindings.insert(values, 3, at), RangeError);
  }
  for (const at of [-1, 2, 0.5, '1', undefined, NaN, Infinity]) {
    assert.throws(() => bindings.remove(values, at), RangeError);
  }
  assert.throws(() => bindings.insert(values, {}), TypeError);
  assert.deepEqual(values.values, [1, 2]);
  assert.throws(() => bindings.remove(list(), 0), RangeError);
  for (const target of [dict(), vectorBindings.vec2f(1), matrixBindings.mat2x2f(1, 0, 0, 1), [], null]) {
    assert.throws(() => bindings.insert(target, 1), TypeError);
    assert.throws(() => bindings.remove(target, 0), TypeError);
  }
  assert.throws(() => bindings.insert(), TypeError);
  assert.throws(() => bindings.insert(values), TypeError);
  assert.throws(() => bindings.insert(values, 1, 0, 2), TypeError);
  assert.throws(() => bindings.remove(values), TypeError);
  assert.throws(() => bindings.remove(values, 0, 1), TypeError);
});

test('remove accepts nil as a no-op index and composes with where in both modes', () => {
  const values = list('pear');
  assert.equal(bindings.remove(values, null), values);
  assert.deepEqual(values.values, ['pear']);
  const empty = list();
  assert.equal(bindings.remove(empty, null), empty);
  assert.throws(() => bindings.remove(dict(), null), TypeError);
  assert.throws(() => bindings.remove(values), TypeError);
  for (const trace of [true, false]) {
    const evaluate = source => compile(source, bindings, forms, { trace }).run();
    assert.deepEqual(evaluate(`(let fruits (list "pear" "apple" "banana"))
      (remove fruits (where fruits "apple")) fruits`).values, ['pear', 'banana']);
    assert.deepEqual(evaluate(`(let fruits (list "pear" "banana"))
      (remove fruits (where fruits "apple")) fruits`).values, ['pear', 'banana']);
    assert.deepEqual(evaluate(`(let fruits (list "apple" "pear"))
      (remove fruits (where fruits "apple")) fruits`).values, ['pear']);
    assert.equal(evaluate('(let fruits (list)) (= (remove fruits nil) fruits)'), true);
  }
});

test('list editing works with nested dot access, nil, aliases, and first-class bindings in both modes', () => {
  for (const trace of [true, false]) {
    const evaluate = source => compile(source, bindings, forms, { trace }).run();
    assert.deepEqual(evaluate(`(let state (dict "items" (list 10 20)))
      (let alias state.items) (insert state.items 30) (insert alias 15 1)
      (remove state.items 0) alias`).values, [15, 20, 30]);
    assert.equal(evaluate('(let items (list)) (let add insert) (add items nil) (len items)'), 1);
    assert.equal(evaluate('(let items (list 1)) (remove items 0) (bool items)'), false);
    assert.equal(evaluate('(let items (list 1)) (= (insert items 2) items)'), true);
    assert.equal(evaluate('(let items (list)) (insert items items) (= items.0 items)'), true);
    assert.throws(() => evaluate('(remove (list 1) 1)'), error => error instanceof RangeError && (!trace || Boolean(error.lisp)));
    assert.throws(() => evaluate('(insert (list) 1 nil)'), error => error instanceof RangeError && (!trace || Boolean(error.lisp)));
  }
});

test('in searches list values using structural equality, including nested and cyclic data', () => {
  const member = bindings.in;
  assert.equal(member(2, list(1, 2, 3)), true);
  assert.equal(member('2', list(1, 2, 3)), false);
  assert.equal(member(1, list()), false);
  assert.equal(member(NaN, list(NaN)), true);
  assert.equal(member(0, list(-0)), false);
  assert.equal(member(undefined, list(undefined)), true);
  assert.equal(member(dict('name', list('Shawn')), list(dict('name', list('Shawn')))), true);
  assert.equal(member(vectorBindings.vec2f(1, 2), list(vectorBindings.vec2f(1, 2))), true);
  assert.equal(member(list(1, 2), list(vectorBindings.vec2f(1, 2))), false);
  const cyclic = list(0); put(cyclic, 0, cyclic);
  assert.equal(member(reCopy(cyclic), list(cyclic)), true);
  const values = list(1);
  put(values, 0, 2);
  assert.equal(member(1, values), false);
  assert.equal(member(2, values), true);
});

test('in checks dict own keys regardless of stored value and rejects invalid arguments', () => {
  const member = bindings.in;
  const value = dict('empty', undefined, 'false', false, '__proto__', 1, '', 2, '42', 3);
  for (const key of ['empty', 'false', '__proto__', '', '42']) assert.equal(member(key, value), true);
  for (const key of ['missing', 'constructor', 'toString']) assert.equal(member(key, value), false);
  assert.equal(member('key', dict()), false);
  for (const key of [42, undefined, null, list('42')]) assert.throws(() => member(key, value), TypeError);
  for (const target of [[], {}, 'abc', 1, null, vectorBindings.vec2f(1), matrixBindings.mat2x2f(1, 0, 0, 1)]) {
    assert.throws(() => member(1, target), TypeError);
  }
  assert.throws(() => member(), TypeError);
  assert.throws(() => member(1), TypeError);
  assert.throws(() => member(1, list(1), 2), TypeError);
});

test('in works in both compiler modes, conditionals, nested access, and as a first-class binding', () => {
  for (const trace of [true, false]) {
    const events = [];
    const evaluate = source => compile(source, {
      ...bindings, needle: () => { events.push('value'); return 2; },
      collection: () => { events.push('collection'); return list(1, 2); },
    }, forms, { trace }).run();
    assert.equal(evaluate('(in (needle) (collection))'), true);
    assert.deepEqual(events, ['value', 'collection']);
    assert.equal(evaluate('(let state (dict "items" (list 1 2))) (in 2 state.items)'), true);
    assert.equal(evaluate('(let member in) (member "name" (dict "name" "Shawn"))'), true);
    assert.equal(evaluate('((fn () (if (in 2 (list 1 2)) { (return "found") }) (return "missing")))'), 'found');
    for (const source of ['(in 2 (dict "2" 1))', '(in 1 (vec2f 1))', '(in)', '(in 1)', '(in 1 (list 1) 2)']) {
      assert.throws(() => evaluate(source), error => error instanceof TypeError && (!trace || Boolean(error.lisp)), source);
    }
  }
});

test('dict replaces map in bindings, annotations, and serialized tags', () => {
  assert.equal(Object.hasOwn(bindings, 'dict'), true);
  assert.equal(Object.hasOwn(bindings, 'map'), false);
  const value = dict('name', 'Shawn');
  assert.equal(value.type, 'dict');
  assert.equal(JSON.parse(serializeData(value)).type, 'dict');
  assert.throws(() => deserializeData('{"type":"map","values":{"name":"Shawn"}}'), TypeError);
  assert.throws(() => compile('(map "name" "Shawn")', bindings, forms), SyntaxError);
  assert.throws(() => compile('(fn (value:map))', bindings, forms), SyntaxError);
});

test('put mutates shared collections and numeric data, while copy isolates outer storage', () => {
  const position = vectorBindings.vec3f(1, 2, 3);
  const original = dict('position', position, 'items', list(1, dict('name', 'first')));
  const alias = original;
  const moved = put(copy(original), 'position', vectorBindings.vec3f(4, 5, 6));
  assert.equal(get(original, 'position'), position);
  assert.equal(get(moved, 'items'), get(original, 'items'));
  assert.equal(put(alias, 'name', 'shared'), original);
  assert.equal(get(original, 'name'), 'shared');
  const duplicated = copy(position);
  assert.equal(put(duplicated, 0, 4), duplicated);
  assert.equal(get(position, 0), 1);
  assert.equal(get(duplicated, 0), 4);
  assert.throws(() => put(position, 0, '4'), TypeError);
  assert.throws(() => { position.values.push(4); }, TypeError);
  const items = list(1, 2);
  assert.deepEqual(put(items, 0, 3).values, [3, 2]);
  assert.deepEqual(items.values, [3, 2]);
  for (const value of [[], {}, new Float32Array(2), Object.freeze({ type: 'vec2f', values: [1, 2] })]) {
    assert.throws(() => list(value), TypeError);
    assert.throws(() => dict('key', value), TypeError);
  }
});

test('dicts handle special property names as ordinary keys and validate inputs', () => {
  const value = dict('__proto__', 1, 'constructor', 2, 'toString', 3, 'same', 1, 'same', 4);
  assert.equal(get(value, '__proto__'), 1);
  assert.equal(get(value, 'constructor'), 2);
  assert.equal(get(value, 'missing'), null);
  assert.equal(get(value, 'same'), 4);
  assert.equal(get(put(value, '__proto__', 5), '__proto__'), 5);
  assert.throws(() => dict('key'), TypeError);
  assert.throws(() => dict(1, 2), TypeError);
  assert.throws(() => get(value, 1), TypeError);
  for (const key of [-1, 1, 0.5, '0', NaN]) assert.throws(() => get(list(1), key), RangeError);
  assert.throws(() => put(list(1), 1, 2), RangeError);
});

test('value equality compares nested contents, types, and dict keys independent of order', () => {
  assert.equal(equal(dict('a', list(1), 'b', vectorBindings.vec2f(2, 3)),
    dict('b', vectorBindings.vec2f(2, 3), 'a', list(1))), true);
  assert.equal(equal(list(1, 2), vectorBindings.vec2f(1, 2)), false);
  assert.equal(equal(dict('a', 1), dict('b', 1)), false);
  assert.equal(equal(list(1), list(2)), false);
  assert.equal(equal(1, '1'), false);
  assert.equal(equal(NaN, NaN), true);
  assert.equal(equal(0, -0), false);
});

test('JSON round trips preserve tags, special keys, nested values, and mutable independent storage', () => {
  const value = dict('__proto__', list('hello', true, null), 'position', vectorBindings.vec3f(1, 2, 3));
  const restored = deserializeData(serializeData(value));
  assert.equal(equal(value, restored), true);
  put(get(restored, 'position'), 0, 10);
  assert.equal(get(get(value, 'position'), 0), 1);
  assert.equal(assertType(restored, 'dict'), restored);
  for (const item of [undefined, NaN, Infinity, -0, () => {}]) assert.throws(() => serializeData(item), TypeError);
  for (const text of ['[]', '{}', '{"type":"vec2f","values":[1]}', '{"type":"vec2f","values":["1",2]}',
    '{"type":"dict","values":[]}', '{"type":"list","values":[{}]}',
    '{"type":"list","values":[],"extra":1}', '1e999']) assert.throws(() => deserializeData(text));
});

test('copy accepts every language type and re-copy preserves cycles and shared references', () => {
  const texture = registerTexture(Object.freeze({}));
  for (const value of [null, undefined, 42, NaN, Infinity, 'hello', true, () => {}, texture]) {
    assert.equal(copy(value), value === undefined ? null : value);
    assert.equal(reCopy(value), value === undefined ? null : value);
  }
  const shared = vectorBindings.vec2f(1, 2);
  const original = dict('a', shared, 'b', shared, 'texture', texture);
  put(original, 'self', original);
  const result = reCopy(original);
  assert.notEqual(result, original);
  assert.equal(get(result, 'self'), result);
  assert.equal(get(result, 'a'), get(result, 'b'));
  assert.notEqual(get(result, 'a'), shared);
  assert.equal(get(result, 'texture'), texture);
  assert.equal(equal(result, original), true);
  put(get(result, 'a'), 0, 9);
  assert.equal(get(shared, 0), 1);
  assert.equal(equal(result, original), false);
  assert.throws(() => serializeData(original), TypeError);
  const cyclic = list(0); put(cyclic, 0, cyclic);
  const duplicated = reCopy(cyclic);
  assert.equal(get(duplicated, 0), duplicated);
  assert.equal(equal(cyclic, duplicated), true);
  assert.throws(() => serializeData(cyclic), /Cyclic/);
});

test('square matrices are mutable, copyable, annotated, and JSON serializable', () => {
  for (const size of [2, 3, 4]) {
    const constructor = matrixBindings[`mat${size}x${size}f`];
    const original = constructor(...Array.from({ length: size * size }, (_, i) => i % (size + 1) === 0 ? 1 : 0));
    assert.equal(original.values.length, size * size);
    const duplicated = copy(original);
    assert.notEqual(duplicated.values, original.values);
    put(duplicated, 0, 2);
    assert.equal(get(original, 0), 1);
    assert.equal(equal(original, deserializeData(serializeData(original))), true);
    assert.equal(assertType(original, `mat${size}x${size}f`), original);
    assert.throws(() => constructor(1, 2), TypeError);
    assert.throws(() => put(original, size * size, 1), RangeError);
  }
  assert.deepEqual(matrixBindings.mat2x2f(vectorBindings.vec2f(1, 2), vectorBindings.vec2f(3, 4)).values, [1, 2, 3, 4]);
  assert.throws(() => deserializeData('{"type":"mat2x2f","values":[1,2]}'), TypeError);
});

test('vector and matrix arithmetic produce independent results without changing operands', () => {
  for (const trace of [true, false]) {
    const evaluate = source => compile(source, bindings, forms, { trace }).run();
    assert.equal(evaluate(`(let a (vec3f 1 2 3)) (let alias a) (let b (+ a (vec3f 10 0 0)))
      (put b 0 99) (= a alias)`), true);
    assert.deepEqual(evaluate('(+ (vec3f 1 2 3) 10)').values, [11, 12, 13]);
    assert.deepEqual(evaluate('(- (vec3f 1 2 3))').values, [-1, -2, -3]);
    assert.deepEqual(evaluate('(/ 12 (vec3f 1 2 3))').values, [12, 6, 4]);
    assert.deepEqual(evaluate('(* (mat2x2f 1 2 3 4) (mat2x2f 5 6 7 8))').values, [23, 34, 31, 46]);
    assert.deepEqual(evaluate('(* (mat2x2f 1 2 3 4) (vec2f 10 20))').values, [70, 100]);
    assert.deepEqual(evaluate('(* (vec2f 10 20) (mat2x2f 1 2 3 4))').values, [50, 110]);
    assert.deepEqual(evaluate('(* 2 (mat2x2f 1 2 3 4))').values, [2, 4, 6, 8]);
    assert.deepEqual(evaluate('(+ (mat2x2f 1 0 0 1) (mat2x2f 2 0 0 2))').values, [3, 0, 0, 3]);
    assert.deepEqual(evaluate('(vec3f 1 2 3).xy').values, [1, 2]);
    assert.equal(evaluate('(vec3f 1 2 3).x'), 1);
    for (const source of ['(+ (vec2f 1) (vec3f 1))', '(+ (mat2x2f 1 0 0 1) 1)', '(/ (mat2x2f 1 0 0 1) 2)',
      '(* (mat2x2f 1 0 0 1) (vec3f 1))', '(+ (vec2f 1) "2")']) {
      assert.throws(() => evaluate(source), TypeError);
    }
  }
  for (const constructor of [vectorBindings.vec2f, matrixBindings.mat2x2f]) {
    const original = constructor(...(constructor === matrixBindings.mat2x2f ? [2, 0, 0, 2] : [2]));
    for (const operator of ['+', '*', '-', '/']) {
      if (operator === '/' && original.type === 'mat2x2f') continue;
      const result = bindings[operator](original);
      assert.notEqual(result, original);
      put(result, 0, 99);
      assert.equal(get(original, 0), 2);
    }
  }
});

test('Lisp collections work with annotations, conditionals, closures, and JSON in both modes', () => {
  for (const trace of [true, false]) {
    const evaluate = source => compile(source, bindings, forms, { trace }).run();
    assert.equal(evaluate(`(let player (dict "name" "Shawn" "position" (vec3f 0)))
      (let moved (put player "position" (vec3f 1 0 0)))
      (= player (from-json (to-json player)))`), true);
    assert.equal(evaluate('((fn (items:list) (return (get items 1))) (list 1 42))'), 42);
    assert.equal(evaluate('((fn (object:dict) (return (len object))) (dict "a" 1))'), 1);
    assert.equal(evaluate(`(let original (dict "items" (list 1)))
      (let duplicated (re-copy original))
      (put (get duplicated "items") 0 2)
      (get (get original "items") 0)`), 1);
    assert.equal(evaluate(`(let items (list 1 2))
      (let read (fn () (return (get items 0))))
      (if (= (len items) 2) { (set items (put items 0 3)) }) (read)`), 3);
    assert.throws(() => evaluate('((list 1 2) : vec2f)'), TypeError);
    assert.throws(() => evaluate('((vec2f 1 2) : list)'), TypeError);
    assert.throws(() => evaluate('(get (list 1) 4)'), error => error instanceof RangeError && (!trace || Boolean(error.lisp)));
  }
});
