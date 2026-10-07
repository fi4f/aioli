import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../engine/compiler.js';
import { forms } from '../engine/forms.js';
import { bindings } from '../engine/bindings.js';
import { assertType } from '../engine/types.js';
import { typeAliases } from '../engine/numeric-types.js';
import { serializeData, get } from '../engine/data.js';
import { createArray, collectionInfo } from '../engine/structures.js';

test('float vector and square matrix aliases share constructors and canonical value tags', () => {
  for (const trace of [true, false]) for (const [alias, type] of Object.entries(typeAliases)) {
    const n = Number(alias.at(-1));
    const args = alias.startsWith("vec") ? "1" : Array.from({ length: n * n }, (_, i) => i % (n + 1) === 0 ? 1 : 0).join(" ");
    const evaluate = source => compile(source, bindings, forms, { trace }).run();
    assert.equal(bindings[alias], bindings[type]);
    const value = evaluate(`(${alias} ${args})`);
    assert.equal(value.type, type);
    assert.equal(assertType(value, alias), value);
    assert.equal(evaluate(`((${alias} ${args}) : ${alias})`).type, type);
    assert.equal(evaluate(`(let f (fn (v:${alias}) (return v))) (f (${type} ${args}))`).type, type);
    assert.equal(evaluate(`(${alias}? (${type} ${args}))`), true);
    assert.equal(JSON.parse(serializeData(value)).type, type);
    const rows = evaluate(`(struct S value:${alias}) (array (S) (S value (${alias} ${args})))`);
    assert.equal(get(get(rows, 0), 'value').type, type);
    assert.equal(collectionInfo(createArray(alias, 2)).element.type, type);
  }
});

test('aliases work in nested collection annotations, shader constructors, uniforms, and helper parameters', () => {
  for (const [alias, type] of Object.entries(typeAliases)) {
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
    const shader = compile(source, bindings, forms).shaders[0];
    assert.equal(shader.uniforms[0].type, type);
    assert.equal(shader.uniforms[1].type, `array<${type}>`);
    assert.equal(shader.uniforms[2].type, `many<${type},2>`);
    assert.match(shader.wgsl, new RegExp(`argument0: ${type}`));
  }
  const shader = compile(`(sh (nested:array<array<vec2,2>,3>) (return (vec4 nested.0.0 0 1)))`, bindings, forms).shaders[0];
  assert.equal(shader.uniforms[0].type, 'array<array<vec2f,2>,3>');
});
