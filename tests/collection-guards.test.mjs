import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../engine/compiler.js';
import { forms } from '../engine/forms.js';
import { bindings } from '../engine/bindings.js';
import { list, dict } from '../engine/data.js';
import { createArray, createMany } from '../engine/structures.js';

test('collection predicates distinguish registered language types from host values and each other', () => {
  const values = { list: list(), dict: dict(), array: createArray('f32', 2), many: createMany('f32', undefined) };
  for (const type of Object.keys(values)) {
    const guard = bindings[`${type}?`];
    for (const [kind, value] of Object.entries(values)) assert.equal(guard(value), type === kind);
    for (const value of [null, undefined, false, 0, '', [], {}, new Float32Array(2), { type, values: [] }, bindings.vec2()]) assert.equal(guard(value), false);
    assert.throws(() => guard(), TypeError);
    assert.throws(() => guard(values[type], values[type]), TypeError);
  }
});

test('regular Lisp collection guards are first-class, work in conditions, and evaluate arguments once', () => {
  for (const trace of [true, false]) {
    for (const [type, constructor] of [['list', '(list 1)'], ['dict', '(dict "a" 1)'], ['array', '(array (f32 2))'], ['many', '(many (f32 2))']]) {
      let calls = 0;
      const value = compile(constructor, bindings, forms, { trace }).run();
      const program = compile(`(let guard ${type}?) (let result (if (guard (next)) true false)) result`, {
        ...bindings, next: () => { calls++; return value; },
      }, forms, { trace });
      assert.equal(program.run(), true); assert.equal(calls, 1);
      assert.equal(compile(`(${type}? nil)`, bindings, forms, { trace }).run(), false);
      assert.throws(() => compile(`(${type}?)`, bindings, forms, { trace }).run(), error => error instanceof TypeError && (!trace || Boolean(error.lisp)));
    }
  }
});
