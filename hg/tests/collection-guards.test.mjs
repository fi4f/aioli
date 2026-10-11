import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Compiler } from "../compiler.js";
import { Forms } from "../forms.js";
import { Bindings } from "../bindings.js";
import { Data } from "../data.js";
import { Structures } from "../structures.js";

test('collection predicates recognize native collections and distinguish typed storage', () => {
  const values = { list: Data.list(), dict: Data.dict(), array: Structures.createArray('f32', 2), many: Structures.createMany('f32', undefined) };
  for (const type of Object.keys(values)) {
    const guard = Bindings[`${type}?`];
    for (const [kind, value] of Object.entries(values)) assert.equal(guard(value), type === kind);
    for (const [kind, value] of [[null, null], [null, undefined], [null, false], [null, 0], [null, ''], ['list', []], ['dict', {}], [null, new Float32Array(2)], ['dict', { type, values: [] }], [null, Bindings.vec2()]]) assert.equal(guard(value), kind === type);
    assert.throws(() => guard(), TypeError);
    assert.throws(() => guard(values[type], values[type]), TypeError);
  }
});

test('regular Lisp collection guards are first-class, work in conditions, and evaluate arguments once', () => {
  for (const trace of [true, false]) {
    for (const [type, constructor] of [['list', '(list 1)'], ['dict', '(dict "a" 1)'], ['array', '(array (f32 2))'], ['many', '(many (f32 2))']]) {
      let calls = 0;
      const value = Compiler.run(Compiler.compile(constructor, Bindings, Forms, { trace }));
      const program = Compiler.compile(`(let guard ${type}?) (let result (if (guard (next)) true false)) result`, {
        ...Bindings, next: () => { calls++; return value; },
      }, Forms, { trace });
      assert.equal(Compiler.run(program), true); assert.equal(calls, 1);
      assert.equal(Compiler.run(Compiler.compile(`(${type}? nil)`, Bindings, Forms, { trace })), false);
      assert.throws(() => Compiler.run(Compiler.compile(`(${type}?)`, Bindings, Forms, { trace })), error => error instanceof TypeError && (!trace || Boolean(error.lisp)));
    }
  }
});
