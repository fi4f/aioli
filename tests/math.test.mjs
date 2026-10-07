import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../engine/compiler/compiler.js';
import { bindings } from '../engine/language/bindings.js';
import { forms } from '../engine/compiler/forms.js';
const evaluate = (source, trace, extra = {}) => compile(source, { ...bindings, ...extra }, forms, { trace }).run();

test('math functions evaluate scalar and float-vector components and preserve independent storage', () => {
  const operations = { sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, sqrt: Math.sqrt };
  for (const trace of [true,false]) {
    for (const [name, op] of Object.entries(operations)) {
      assert.equal(evaluate(`(${name} 0.5)`, trace), op(0.5));
      assert.deepEqual(evaluate(`(${name} (vec2 0 0.5))`, trace).values, [Math.fround(op(0)), Math.fround(op(0.5))]);
    }
    assert.equal(evaluate('(min 2 3)', trace), 2); assert.equal(evaluate('(max 2 3)', trace), 3);
    assert.equal(evaluate('(clamp 4 0 1)', trace), 1);
    assert.deepEqual(evaluate('(clamp (vec3 -1 0.5 2) 0 1)', trace).values, [0,0.5,1]);
    assert.deepEqual(evaluate('(min 2 (vec3 1 3 0))', trace).values, [1,2,0]);
    assert.deepEqual(evaluate('(min (vec2 1) 0.1)', trace).values, [Math.fround(0.1),Math.fround(0.1)]);
    assert.deepEqual(evaluate('(max (vec2i -2 3) (vec2i 1 2))', trace).values, [1,3]);
    assert.deepEqual(evaluate('(clamp (vec2u 0 4) 1 3)', trace).values, [1,3]);
    assert.equal(evaluate('(let p (vec2 1 2)) (let q (max p 0)) (set q.x 99) p.x', trace), 1);
    assert.ok(Number.isNaN(evaluate('(sqrt -1)', trace)));
    let calls = 0; evaluate('(clamp (next 0.5) (next 0) (next 1))', trace, { next: n => { calls++; return n; } }); assert.equal(calls, 3);
    for (const source of ['(sin)', '(sin 1 2)', '(min 1)', '(max 1 2 3)', '(clamp 1 0)', '(sqrt true)', '(cos (vec2i))', '(min (vec2) (vec3))', '(max (vec2u) (vec2i))', '(min nil 1)', '(clamp 0 2 1)']) assert.throws(() => evaluate(source, trace), Error);
  }
});

test('shader math emits builtins, broadcasts scalars and validates shapes and families', () => {
  const shader = expression => compile(`(sh () (return (vec4 ${expression})))`, bindings, forms).shaders[0].wgsl;
  for (const name of ['sin','cos','tan','asin','acos','atan','sqrt']) {
    assert.match(shader(`(${name} 0.5)`), new RegExp(`${name}\\(0\\.5f\\)`));
    assert.doesNotThrow(() => shader(`(${name} (vec4 0.5))`));
  }
  assert.match(shader('(min (vec4 2) 1)'), /min\(vec4f\(2f\), vec4f\(1f\)\)/);
  assert.doesNotThrow(() => shader('(clamp (vec4 2) 0 1)'));
  assert.doesNotThrow(() => shader('(max (vec4i 2) (i32 1))'));
  for (const expression of ['(sin)', '(min 1)', '(max 1 2 3)', '(clamp 1 2 1)', '(sqrt (vec4i))', '(min (vec2) (vec3))', '(max (i32 1) 2)', '(min (mat2) (mat2))']) assert.throws(() => shader(expression), SyntaxError);
});
