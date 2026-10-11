import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Compiler } from "../compiler.js";
import { Forms } from "../forms.js";
import { Bindings } from "../bindings.js";
import { Data } from "../data.js";
import { Types } from "../types.js";

test('deferred snapshots retain normal mutable list, copy, and serialization behavior', () => {
  const built = [];
  const snapshot = Data.lazyList(5, index => { built.push(index); return Data.dict('index', index); });
  assert.equal(Bindings.len(snapshot), 5);
  assert.deepEqual(built, []);
  assert.equal(Data.values(Data.get(snapshot, 3)).index, 3);
  Data.put(snapshot, 1, 'edited');
  assert.deepEqual(built, [3]);
  Bindings.insert(snapshot, 'inserted', 2);
  Bindings.remove(snapshot, 4);
  assert.deepEqual(Data.values(snapshot).map(value => value?.index ?? value), [0, 'edited', 'inserted', 2, 4]);
  assert.equal(Data.equal(snapshot, Data.copy(snapshot)), true);
  assert.equal(Data.equal(snapshot, Data.reCopy(snapshot)), true);
  assert.equal(Data.equal(snapshot, Data.deserializeData(Data.serializeData(snapshot))), true);
  const deferred = Data.lazyList(3, index => index);
  assert.throws(() => { Data.values(deferred).length = -1; }, RangeError);
  assert.deepEqual([...Data.values(deferred)], [0, 1, 2]);
  const truncated = Data.lazyList(5, index => index);
  Data.values(truncated).length = 2;
  Data.values(truncated).length = 5;
  assert.deepEqual([...Data.values(truncated)], [0, 1, undefined, undefined, undefined]);
  const frozen = Data.lazyList(3, index => index);
  Object.freeze(Data.values(frozen));
  assert.deepEqual([...Data.values(frozen)], [0, 1, 2]);
  assert.throws(() => { Data.values(frozen)[1] = 9; }, TypeError);
});

test('where returns the first structurally equal list index or nil', () => {
  const find = Bindings.where;
  assert.equal(find(Data.list(10, 20, 10), 10), 0);
  assert.equal(find(Data.list(10, 20, 20), 20), 1);
  assert.equal(find(Data.list(10, 20), '20'), null);
  assert.equal(find(Data.list(), 1), null);
  assert.equal(find(Data.list(1, null), null), 1);
  assert.throws(() => find(Data.list(NaN), NaN), TypeError);
  assert.equal(find(Data.list(0, -0), -0), 1);
  assert.equal(find(Data.list(Data.dict('items', Data.list(1))), Data.dict('items', Data.list(1))), 0);
  assert.equal(find(Data.list(Types.vectorBindings.vec2f(1, 2)), Types.vectorBindings.vec2f(1, 2)), 0);
  const cyclic = Data.list(null); Data.put(cyclic, 0, cyclic);
  assert.equal(find(Data.list(cyclic), Data.reCopy(cyclic)), 0);
  const values = Data.list(1, 2);
  Bindings.insert(values, 0, 0);
  assert.equal(find(values, 2), 2);
  Bindings.remove(values, 1);
  assert.equal(find(values, 2), 1);
});

test('where searches dict values and preserves empty, numeric, and special keys', () => {
  const find = Bindings.where;
  assert.equal(find(Data.dict('first', 42, 'second', 42), 42), 'first');
  assert.equal(find(Data.dict('name', 'Shawn'), 'name'), null);
  assert.equal(find(Data.dict('name', 'Shawn'), 'Shawn'), 'name');
  assert.equal(find(Data.dict('empty', null), null), 'empty');
  assert.equal(find(Data.dict('', 1), 1), '');
  assert.equal(find(Data.dict('42', 1), 1), '42');
  assert.equal(find(Data.dict('__proto__', 1), 1), '__proto__');
  assert.equal(find(Data.dict('nested', Data.list(1, 2)), Data.list(1, 2)), 'nested');
  assert.equal(find(Data.dict(), 1), null);
  assert.equal(find(Data.dict('absent', 2), 1), null);
  for (const value of [Data.list(1), Data.dict('key', 1)]) {
    assert.throws(() => find(), TypeError);
    assert.throws(() => find(1), TypeError);
    assert.throws(() => find(value, 1, 2), TypeError);
  }
  for (const target of [null, 'abc', Types.vectorBindings.vec2f(1), Types.matrixBindings.mat2x2f(1, 0, 0, 1)]) {
    assert.throws(() => find(target, 1), TypeError);
  }
});

test('where is a first-class Lisp binding with eager ordered arguments and source traces', () => {
  for (const trace of [true, false]) {
    const events = [];
    const evaluate = source => Compiler.run(Compiler.compile(source, {
      ...Bindings, needle: () => { events.push('value'); return 2; },
      values: () => { events.push('collection'); return Data.list(1, 2); },
    }, Forms, { trace }));
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
  const values = Data.list(10, 20);
  const alias = values;
  assert.equal(Bindings.insert(values, 30), values);
  assert.deepEqual(Data.values(alias), [10, 20, 30]);
  Bindings.insert(values, 15, 1);
  Bindings.insert(values, 5, 0);
  Bindings.insert(values, 40, Data.values(values).length);
  assert.deepEqual(Data.values(values), [5, 10, 15, 20, 30, 40]);
  assert.equal(Bindings.remove(values, 2), values);
  assert.deepEqual(Data.values(values), [5, 10, 20, 30, 40]);
  Bindings.remove(values, 0);
  Bindings.remove(values, Data.values(values).length - 1);
  assert.deepEqual(Data.values(values), [10, 20, 30]);
  const independent = Data.copy(values);
  Bindings.insert(independent, 99);
  assert.deepEqual(Data.values(values), [10, 20, 30]);
  const empty = Data.list();
  Bindings.insert(empty, undefined);
  assert.deepEqual(Data.values(empty), [null]);
  Bindings.remove(empty, 0);
  assert.deepEqual(Data.values(empty), []);
});

test('list insertion and removal validate bounds, arity, and types before mutating', () => {
  const values = Data.list(1, 2);
  for (const at of [-1, 3, 0.5, '1', null, undefined, NaN, Infinity]) {
    assert.throws(() => Bindings.insert(values, 3, at), RangeError);
  }
  for (const at of [-1, 2, 0.5, '1', undefined, NaN, Infinity]) {
    assert.throws(() => Bindings.remove(values, at), RangeError);
  }
  assert.throws(() => Bindings.insert(values, new Float32Array(2)), TypeError);
  assert.deepEqual(Data.values(values), [1, 2]);
  assert.throws(() => Bindings.remove(Data.list(), 0), RangeError);
  for (const target of [Data.dict(), Types.vectorBindings.vec2f(1), Types.matrixBindings.mat2x2f(1, 0, 0, 1), null]) {
    assert.throws(() => Bindings.insert(target, 1), TypeError);
    assert.throws(() => Bindings.remove(target, 0), TypeError);
  }
  assert.throws(() => Bindings.insert(), TypeError);
  assert.throws(() => Bindings.insert(values), TypeError);
  assert.throws(() => Bindings.insert(values, 1, 0, 2), TypeError);
  assert.throws(() => Bindings.remove(values), TypeError);
  assert.throws(() => Bindings.remove(values, 0, 1), TypeError);
});

test('remove accepts nil as a no-op index and composes with where in both modes', () => {
  const values = Data.list('pear');
  assert.equal(Bindings.remove(values, null), values);
  assert.deepEqual(Data.values(values), ['pear']);
  const empty = Data.list();
  assert.equal(Bindings.remove(empty, null), empty);
  assert.throws(() => Bindings.remove(Data.dict(), null), TypeError);
  assert.throws(() => Bindings.remove(values), TypeError);
  for (const trace of [true, false]) {
    const evaluate = source => Compiler.run(Compiler.compile(source, Bindings, Forms, { trace }));
    assert.deepEqual(Data.values(evaluate(`(let fruits (list "pear" "apple" "banana"))
      (remove fruits (where fruits "apple")) fruits`)), ['pear', 'banana']);
    assert.deepEqual(Data.values(evaluate(`(let fruits (list "pear" "banana"))
      (remove fruits (where fruits "apple")) fruits`)), ['pear', 'banana']);
    assert.deepEqual(Data.values(evaluate(`(let fruits (list "apple" "pear"))
      (remove fruits (where fruits "apple")) fruits`)), ['pear']);
    assert.equal(evaluate('(let fruits (list)) (= (remove fruits nil) fruits)'), true);
  }
});

test('list editing works with nested dot access, nil, aliases, and first-class bindings in both modes', () => {
  for (const trace of [true, false]) {
    const evaluate = source => Compiler.run(Compiler.compile(source, Bindings, Forms, { trace }));
    assert.deepEqual(Data.values(evaluate(`(let state (dict "items" (list 10 20)))
      (let alias state.items) (insert state.items 30) (insert alias 15 1)
      (remove state.items 0) alias`)), [15, 20, 30]);
    assert.equal(evaluate('(let items (list)) (let add insert) (add items nil) (len items)'), 1);
    assert.equal(evaluate('(let items (list 1)) (remove items 0) (bool items)'), false);
    assert.equal(evaluate('(let items (list 1)) (= (insert items 2) items)'), true);
    assert.equal(evaluate('(let items (list)) (insert items items) (= items.0 items)'), true);
    assert.throws(() => evaluate('(remove (list 1) 1)'), error => error instanceof RangeError && (!trace || Boolean(error.lisp)));
    assert.throws(() => evaluate('(insert (list) 1 nil)'), error => error instanceof RangeError && (!trace || Boolean(error.lisp)));
  }
});

test('in searches list values using structural equality, including nested and cyclic data', () => {
  const member = Bindings.in;
  assert.equal(member(2, Data.list(1, 2, 3)), true);
  assert.equal(member('2', Data.list(1, 2, 3)), false);
  assert.equal(member(1, Data.list()), false);
  assert.throws(() => member(NaN, Data.list(NaN)), TypeError);
  assert.equal(member(0, Data.list(-0)), false);
  assert.equal(member(undefined, Data.list(undefined)), true);
  assert.equal(member(Data.dict('name', Data.list('Shawn')), Data.list(Data.dict('name', Data.list('Shawn')))), true);
  assert.equal(member(Types.vectorBindings.vec2f(1, 2), Data.list(Types.vectorBindings.vec2f(1, 2))), true);
  assert.equal(member(Data.list(1, 2), Data.list(Types.vectorBindings.vec2f(1, 2))), false);
  const cyclic = Data.list(0); Data.put(cyclic, 0, cyclic);
  assert.equal(member(Data.reCopy(cyclic), Data.list(cyclic)), true);
  const values = Data.list(1);
  Data.put(values, 0, 2);
  assert.equal(member(1, values), false);
  assert.equal(member(2, values), true);
});

test('in checks dict own keys regardless of stored value and rejects invalid arguments', () => {
  const member = Bindings.in;
  const value = Data.dict('empty', undefined, 'false', false, '__proto__', 1, '', 2, '42', 3);
  for (const key of ['empty', 'false', '__proto__', '', '42']) assert.equal(member(key, value), true);
  for (const key of ['missing', 'constructor', 'toString']) assert.equal(member(key, value), false);
  assert.equal(member('key', Data.dict()), false);
  for (const key of [42, undefined, null, Data.list('42')]) assert.throws(() => member(key, value), TypeError);
  for (const target of [{}, 'abc', 1, null, Types.vectorBindings.vec2f(1), Types.matrixBindings.mat2x2f(1, 0, 0, 1)]) {
    assert.throws(() => member(1, target), TypeError);
  }
  assert.throws(() => member(), TypeError);
  assert.throws(() => member(1), TypeError);
  assert.throws(() => member(1, Data.list(1), 2), TypeError);
});

test('in works in both compiler modes, conditionals, nested access, and as a first-class binding', () => {
  for (const trace of [true, false]) {
    const events = [];
    const evaluate = source => Compiler.run(Compiler.compile(source, {
      ...Bindings, needle: () => { events.push('value'); return 2; },
      collection: () => { events.push('collection'); return Data.list(1, 2); },
    }, Forms, { trace }));
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

test('dict replaces map in bindings and annotations and serializes as a native object', () => {
  assert.equal(Object.hasOwn(Bindings, 'dict'), true);
  assert.equal(Object.hasOwn(Bindings, 'map'), false);
  const value = Data.dict('name', 'Shawn');
  assert.deepEqual(value, { name: 'Shawn' });
  assert.deepEqual(JSON.parse(Data.serializeData(value)), { name: 'Shawn' });
  assert.deepEqual(Data.deserializeData('{"type":"map","values":{"name":"Shawn"}}'), { type: 'map', values: { name: 'Shawn' } });
  assert.throws(() => Compiler.compile('(map "name" "Shawn")', Bindings, Forms), SyntaxError);
  assert.throws(() => Compiler.compile('(fn (value:map))', Bindings, Forms), SyntaxError);
});

test('put mutates shared collections and numeric data, while copy isolates outer storage', () => {
  const position = Types.vectorBindings.vec3f(1, 2, 3);
  const original = Data.dict('position', position, 'items', Data.list(1, Data.dict('name', 'first')));
  const alias = original;
  const moved = Data.put(Data.copy(original), 'position', Types.vectorBindings.vec3f(4, 5, 6));
  assert.equal(Data.get(original, 'position'), position);
  assert.equal(Data.get(moved, 'items'), Data.get(original, 'items'));
  assert.equal(Data.put(alias, 'name', 'shared'), original);
  assert.equal(Data.get(original, 'name'), 'shared');
  const duplicated = Data.copy(position);
  assert.equal(Data.put(duplicated, 0, 4), duplicated);
  assert.equal(Data.get(position, 0), 1);
  assert.equal(Data.get(duplicated, 0), 4);
  assert.throws(() => Data.put(position, 0, '4'), TypeError);
  const previousZ = position.z;
  delete position.z;
  assert.throws(() => Types.assertType(position, 'vec3f'), TypeError);
  position.z = previousZ;
  const items = Data.list(1, 2);
  assert.deepEqual(Data.values(Data.put(items, 0, 3)), [3, 2]);
  assert.deepEqual(Data.values(items), [3, 2]);
  for (const value of [new Float32Array(2), new Map()]) {
    assert.throws(() => Data.list(value), TypeError);
    assert.throws(() => Data.dict('key', value), TypeError);
  }
});

test('dicts handle special property names as ordinary keys and validate inputs', () => {
  const value = Data.dict('__proto__', 1, 'constructor', 2, 'toString', 3, 'same', 1, 'same', 4);
  assert.equal(Data.get(value, '__proto__'), 1);
  assert.equal(Data.get(value, 'constructor'), 2);
  assert.equal(Data.get(value, 'missing'), null);
  assert.equal(Data.get(value, 'same'), 4);
  assert.equal(Data.get(Data.put(value, '__proto__', 5), '__proto__'), 5);
  assert.deepEqual(Data.dict('key'), { key: null });
  assert.throws(() => Data.dict(1, 2), TypeError);
  assert.throws(() => Data.get(value, 1), TypeError);
  for (const key of [-1, 1, 0.5, '0', NaN]) assert.throws(() => Data.get(Data.list(1), key), RangeError);
  assert.throws(() => Data.put(Data.list(1), 1, 2), RangeError);
});

test('value equality compares nested contents, types, and dict keys independent of order', () => {
  assert.equal(Data.equal(Data.dict('a', Data.list(1), 'b', Types.vectorBindings.vec2f(2, 3)),
    Data.dict('b', Types.vectorBindings.vec2f(2, 3), 'a', Data.list(1))), true);
  assert.equal(Data.equal(Data.list(1, 2), Types.vectorBindings.vec2f(1, 2)), false);
  assert.equal(Data.equal(Data.dict('a', 1), Data.dict('b', 1)), false);
  assert.equal(Data.equal(Data.list(1), Data.list(2)), false);
  assert.equal(Data.equal(1, '1'), false);
  assert.throws(() => Data.equal(NaN, NaN), TypeError);
  assert.equal(Data.equal(0, -0), false);
});

test('JSON round trips preserve data fields and decode independent native collections', () => {
  const value = Data.dict('__proto__', Data.list('hello', true, null), 'position', Types.vectorBindings.vec3f(1, 2, 3));
  const restored = Data.deserializeData(Data.serializeData(value));
  assert.deepEqual(restored, { ['__proto__']: ['hello', true, null], position: { __type__: 'vec3f', x: 1, y: 2, z: 3 } });
  Data.put(Data.get(restored, 'position'), 'x', 10);
  assert.equal(Data.get(Data.get(value, 'position'), 0), 1);
  assert.equal(Types.assertType(restored, 'dict'), restored);
  for (const item of [undefined, NaN, Infinity, () => {}]) assert.throws(() => Data.serializeData(item), TypeError);
  for (const text of ['1e999', '[1e999]', '{"value":1e999}']) assert.throws(() => Data.deserializeData(text));
});

test('copy accepts every language type and re-copy preserves cycles and shared references', () => {
  const texture = Types.registerTexture(Object.freeze({}));
  for (const value of [null, undefined, 42, 'hello', true, () => {}, texture]) {
    assert.equal(Data.copy(value), value === undefined ? null : value);
    assert.equal(Data.reCopy(value), value === undefined ? null : value);
  }
  const shared = Types.vectorBindings.vec2f(1, 2);
  const original = Data.dict('a', shared, 'b', shared, 'texture', texture);
  Data.put(original, 'self', original);
  const result = Data.reCopy(original);
  assert.notEqual(result, original);
  assert.equal(Data.get(result, 'self'), result);
  assert.equal(Data.get(result, 'a'), Data.get(result, 'b'));
  assert.notEqual(Data.get(result, 'a'), shared);
  assert.equal(Data.get(result, 'texture'), texture);
  assert.equal(Data.equal(result, original), true);
  Data.put(Data.get(result, 'a'), 0, 9);
  assert.equal(Data.get(shared, 0), 1);
  assert.equal(Data.equal(result, original), false);
  assert.throws(() => Data.serializeData(original), TypeError);
  const cyclic = Data.list(0); Data.put(cyclic, 0, cyclic);
  const duplicated = Data.reCopy(cyclic);
  assert.equal(Data.get(duplicated, 0), duplicated);
  assert.equal(Data.equal(cyclic, duplicated), true);
  assert.throws(() => Data.serializeData(cyclic), /Cyclic/);
});

test('square matrices are mutable, copyable, annotated, and JSON serializable', () => {
  for (const size of [2, 3, 4]) {
    const constructor = Types.matrixBindings[`mat${size}x${size}f`];
    const original = constructor(...Array.from({ length: size * size }, (_, i) => i % (size + 1) === 0 ? 1 : 0));
    assert.equal(Data.values(original).length, size * size);
    const duplicated = Data.copy(original);
    assert.notEqual(Data.values(duplicated), Data.values(original));
    Data.put(duplicated, 0, 2);
    assert.equal(Data.get(original, 0), 1);
    assert.deepEqual(Data.deserializeData(Data.serializeData(original)), { type: original.type, values: Data.values(original) });
    assert.equal(Types.assertType(original, `mat${size}x${size}f`), original);
    assert.throws(() => constructor(1, 2), TypeError);
    assert.throws(() => Data.put(original, size * size, 1), RangeError);
  }
  assert.deepEqual(Data.values(Types.matrixBindings.mat2x2f(Types.vectorBindings.vec2f(1, 2), Types.vectorBindings.vec2f(3, 4))), [1, 2, 3, 4]);
  assert.deepEqual(Data.deserializeData('{"type":"mat2x2f","values":[1,2]}'), { type: 'mat2x2f', values: [1, 2] });
});

test('vector and matrix arithmetic produce independent results without changing operands', () => {
  for (const trace of [true, false]) {
    const evaluate = source => Compiler.run(Compiler.compile(source, Bindings, Forms, { trace }));
    assert.equal(evaluate(`(let a (vec3f 1 2 3)) (let alias a) (let b (+ a (vec3f 10 0 0)))
      (put b 0 99) (= a alias)`), true);
    assert.deepEqual(Data.values(evaluate('(+ (vec3f 1 2 3) 10)')), [11, 12, 13]);
    assert.deepEqual(Data.values(evaluate('(- (vec3f 1 2 3))')), [-1, -2, -3]);
    assert.deepEqual(Data.values(evaluate('(/ 12 (vec3f 1 2 3))')), [12, 6, 4]);
    assert.deepEqual(Data.values(evaluate('(* (mat2x2f 1 2 3 4) (mat2x2f 5 6 7 8))')), [23, 34, 31, 46]);
    assert.deepEqual(Data.values(evaluate('(* (mat2x2f 1 2 3 4) (vec2f 10 20))')), [70, 100]);
    assert.deepEqual(Data.values(evaluate('(* (vec2f 10 20) (mat2x2f 1 2 3 4))')), [50, 110]);
    assert.deepEqual(Data.values(evaluate('(* 2 (mat2x2f 1 2 3 4))')), [2, 4, 6, 8]);
    assert.deepEqual(Data.values(evaluate('(+ (mat2x2f 1 0 0 1) (mat2x2f 2 0 0 2))')), [3, 0, 0, 3]);
    assert.deepEqual(Data.values(evaluate('(vec3f 1 2 3).xy')), [1, 2]);
    assert.equal(evaluate('(vec3f 1 2 3).x'), 1);
    for (const source of ['(+ (vec2f 1) (vec3f 1))', '(+ (mat2x2f 1 0 0 1) 1)', '(/ (mat2x2f 1 0 0 1) 2)',
      '(* (mat2x2f 1 0 0 1) (vec3f 1))', '(+ (vec2f 1) "2")']) {
      assert.throws(() => evaluate(source), TypeError);
    }
  }
  for (const constructor of [Types.vectorBindings.vec2f, Types.matrixBindings.mat2x2f]) {
    const original = constructor(...(constructor === Types.matrixBindings.mat2x2f ? [2, 0, 0, 2] : [2]));
    for (const operator of ['+', '*', '-', '/']) {
      if (operator === '/' && original.type === 'mat2x2f') continue;
      const result = Bindings[operator](original);
      assert.notEqual(result, original);
      Data.put(result, 0, 99);
      assert.equal(Data.get(original, 0), 2);
    }
  }
});

test('Lisp collections work with annotations, conditionals, closures, and JSON in both modes', () => {
  for (const trace of [true, false]) {
    const evaluate = source => Compiler.run(Compiler.compile(source, Bindings, Forms, { trace }));
    assert.equal(evaluate(`(let player (dict "name" "Shawn" "position" (vec3f 0)))
      (let moved (put player "position" (vec3f 1 0 0)))
      (= player (from-json (to-json player)))`), false);
    assert.equal(evaluate('((fn (items:list) (return (get items.1))) (list 1 42))'), 42);
    assert.equal(evaluate('((fn (object:dict) (return (len object))) (dict "a" 1))'), 1);
    assert.equal(evaluate(`(let original (dict "items" (list 1)))
      (let duplicated (re-copy original))
      (put (get duplicated."items") 0 2)
      (get (get original."items").0)`), 1);
    assert.equal(evaluate(`(let items (list 1 2))
      (let read (fn () (return (get items.0))))
      (if (= (len items) 2) { (set items (put items 0 3)) }) (read)`), 3);
    assert.throws(() => evaluate('((list 1 2) : vec2f)'), TypeError);
    assert.throws(() => evaluate('((vec2f 1 2) : list)'), TypeError);
    assert.throws(() => evaluate('(get (list 1).4)'), error => error instanceof RangeError && (!trace || Boolean(error.lisp)));
  }
});
