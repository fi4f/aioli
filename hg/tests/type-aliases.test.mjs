import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Compiler } from "../compiler.js";
import { Forms } from "../forms.js";
import { Bindings } from "../bindings.js";
import { Types } from "../types.js";
import { NumericTypes } from "../numeric-types.js";
import { Data } from "../data.js";
import { Structures } from "../structures.js";

test('float vector and square matrix aliases share constructors and canonical value tags', () => {
  for (const trace of [true, false]) for (const [alias, type] of Object.entries(NumericTypes.typeAliases)) {
    const n = Number(alias.at(-1));
    const args = alias.startsWith("vec") ? "1" : Array.from({ length: n * n }, (_, i) => i % (n + 1) === 0 ? 1 : 0).join(" ");
    const evaluate = source => Compiler.run(Compiler.compile(source, Bindings, Forms, { trace }));
    assert.equal(Bindings[alias], Bindings[type]);
    const value = evaluate(`(${alias} ${args})`);
    assert.equal(Data.dataKind(value), type);
    assert.equal(Types.assertType(value, alias), value);
    assert.equal(Data.dataKind(evaluate(`((${alias} ${args}) : ${alias})`)), type);
    assert.equal(Data.dataKind(evaluate(`(let f (fn (v:${alias}) (return v))) (f (${type} ${args}))`)), type);
    assert.equal(evaluate(`(${alias}? (${type} ${args}))`), true);
    const encoded = JSON.parse(Data.serializeData(value));
    assert.equal(encoded.__type__ ?? encoded.type, type);
    const rows = evaluate(`(struct S value:${alias}) (array (S) (S value (${alias} ${args})))`);
    assert.equal(Data.dataKind(Data.get(Data.get(rows, 0), 'value')), type);
    assert.equal(Structures.collectionInfo(Structures.createArray(alias, 2)).element.type, type);
  }
});

test('aliases work in nested collection annotations, shader constructors, uniforms, and helper parameters', () => {
  for (const [alias, type] of Object.entries(NumericTypes.typeAliases)) {
    const vector = alias.startsWith('vec');
    const n = Number(alias.at(-1));
    const args = vector ? "1" : Array.from({ length: n * n }, (_, i) => i % (n + 1) === 0 ? 1 : 0).join(" ");
    const access = vector ? 'input.x' : 'input.0.0';
    const source = `(struct S values:array<${alias},2> active:many<${alias},2>)
      (sh (input:${alias} rows:array<${alias}> active:many<${alias},2>)
        (let local (${alias} ${args}))
        (let identity (fn (value:${alias}) (return value)))
        (let copied (identity local))
        (return (vec4 (f32 ${access}) (f32 (${alias}? copied)) 0 1)))`;
    const shader = Compiler.compile(source, Bindings, Forms).shaders[0];
    assert.equal(shader.uniforms[0].type, type);
    assert.equal(shader.uniforms[1].type, `array<${type}>`);
    assert.equal(shader.uniforms[2].type, `many<${type},2>`);
    assert.match(shader.wgsl, new RegExp(`argument0: ${type}`));
  }
  const shader = Compiler.compile(`(sh (nested:array<array<vec2,2>,3>) (return (vec4 nested.0.0 0 1)))`, Bindings, Forms).shaders[0];
  assert.equal(shader.uniforms[0].type, 'array<array<vec2f,2>,3>');
});
