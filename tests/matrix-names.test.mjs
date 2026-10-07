import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../engine/compiler/compiler.js';
import { forms } from '../engine/compiler/forms.js';
import { bindings } from '../engine/language/bindings.js';
import { assertType } from '../engine/language/types.js';
import { serializeData, deserializeData } from '../engine/language/data.js';

test('qualified square matrix names work across constructors, assertions, JSON, structs, and shaders', () => {
  for (const size of [2, 3, 4]) {
    const type = `mat${size}x${size}f`;
    const args = Array.from({ length: size * size }, (_, i) => i % (size + 1) === 0 ? 1 : 0).join(" ");
    const value = compile(`(${type} ${args})`, bindings, forms).run();
    assert.equal(value.type, type);
    assert.equal(assertType(value, type), value);
    assert.equal(deserializeData(serializeData(value)).type, type);
    const source = `(struct Item m:${type})
      (let items (array (Item) (Item m (${type} ${args}))))
      (sh (items:array<Item> transform:${type})
        (let local (* items.0.m transform))
        (return (vec4f local.0.0 0 0 1)))`;
    assert.match(compile(source, bindings, forms).shaders[0].wgsl, new RegExp(`f0: ${type}`));
    const alias = `mat${size}`;
    assert.equal(bindings[alias], bindings[type]);
    assert.equal(compile(`(${alias} ${args})`, bindings, forms).run().type, type);
    assert.equal(assertType(value, alias), value);
    assert.throws(() => deserializeData(JSON.stringify({ type: alias, values: value.values })), TypeError);
  }
});
