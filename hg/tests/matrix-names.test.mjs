import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Compiler } from "../compiler.js";
import { Forms } from "../forms.js";
import { Bindings } from "../bindings.js";
import { Types } from "../types.js";
import { Data } from "../data.js";

test('qualified square matrix names work across constructors, assertions, JSON, structs, and shaders', () => {
  for (const size of [2, 3, 4]) {
    const type = `mat${size}x${size}f`;
    const args = Array.from({ length: size * size }, (_, i) => i % (size + 1) === 0 ? 1 : 0).join(" ");
    const value = Compiler.run(Compiler.compile(`(${type} ${args})`, Bindings, Forms));
    assert.equal(value.type, type);
    assert.equal(Types.assertType(value, type), value);
    assert.equal(Data.deserializeData(Data.serializeData(value)).type, type);
    const source = `(struct Item m:${type})
      (let items (array (Item) (Item m (${type} ${args}))))
      (sh (items:array<Item> transform:${type})
        (let local (* items.0.m transform))
        (return (vec4f local.0.0 0 0 1)))`;
    assert.match(Compiler.compile(source, Bindings, Forms).shaders[0].wgsl, new RegExp(`f0: ${type}`));
    const alias = `mat${size}`;
    assert.equal(Bindings[alias], Bindings[type]);
    assert.equal(Compiler.run(Compiler.compile(`(${alias} ${args})`, Bindings, Forms)).type, type);
    assert.equal(Types.assertType(value, alias), value);
    assert.deepEqual(Data.deserializeData(JSON.stringify({ type: alias, values: Data.values(value) })), { type: alias, values: Data.values(value) });
  }
});
