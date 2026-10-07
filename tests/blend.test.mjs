import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../engine/compiler.js';
import { forms } from '../engine/forms.js';
import { bindings } from '../engine/bindings.js';
const evaluate = (source, trace = true, extra = {}) => compile(source, { ...bindings, ...extra }, forms, { trace }).run();

test('blend composites straight-alpha foreground over background and returns fresh vec4f', () => {
  for (const trace of [true, false]) {
    assert.deepEqual(evaluate('(blend (vec4 1 0 0 0.5) (vec4 0 0 1 1))', trace).values, [0.5,0,0.5,1]);
    assert.deepEqual(evaluate('(blend (vec4 1 0 0 0.5) (vec4 0 0 1 0.25))', trace).values,
      [Math.fround(0.8),0,Math.fround(0.2),0.625]);
    assert.deepEqual(evaluate('(blend (vec4 1 0 0 0) (vec4 0 0 1 0))', trace).values, [0,0,0,0]);
    assert.deepEqual(evaluate('(blend (vec4 1 0 0 1) (vec4 0 0 1 0.5))', trace).values, [1,0,0,1]);
    assert.deepEqual(evaluate('(blend (vec4 1 0 0 0) (vec4 0 0 1 0.5))', trace).values, [0,0,1,0.5]);
    assert.deepEqual(evaluate('(blend (vec4 2 0 0 2) (vec4 0 0 1 -1))', trace).values, [2,0,0,1]);
    const a = bindings.vec4(1,0,0,0.5), b = bindings.vec4(0,0,1,1), events = [];
    const result = evaluate('(blend (next 0) (next 1))', trace, { next: i => { events.push(i); return i === 0 ? a : b; } });
    assert.deepEqual(events, [0,1]); assert.notEqual(result, a); assert.notEqual(result, b);
    result.values[0] = 0;
    assert.deepEqual(a.values, [1,0,0,0.5]); assert.deepEqual(b.values, [0,0,1,1]);
  }
  for (const source of ['(blend)', '(blend (vec4))', '(blend (vec4) (vec4) (vec4))', '(blend (vec3) (vec4))', '(blend (vec4i) (vec4))', '(blend (vec4 Infinity) (vec4))']) assert.throws(() => evaluate(source), TypeError);
});

test('shader blend defaults to the current frame UV and before only for its one-color overload', () => {
  const shader = source => compile(source, bindings, forms).shaders[0];
  const explicit = shader('(sh () (return (blend (vec4 1 0 0 0.5) (vec4 0 0 1 0.25))))');
  assert.equal(explicit.resources.length, 0); assert.equal(explicit.hasSampler, false);
  const implicit = shader(`(sh () (let uv (vec2 0))
    (let apply (fn (color:vec4) (return (blend color))))
    (return (blend (apply (vec4 1 0 0 0.5)) (vec4 1))))`);
  assert.equal(implicit.parameterCount, 0); assert.equal(implicit.resources.length, 1);
  assert.equal(implicit.resources[0].name, 'before'); assert.equal(implicit.resources[0].automatic, true);
  assert.match(implicit.wgsl, /textureSampleLevel\(before, shaderSampler, uv, 0f\)/);
  assert.equal((implicit.wgsl.match(/fn blendColors\(/g) || []).length, 1);
  for (const expression of ['(blend)', '(blend (vec3))', '(blend (vec4i))', '(blend (vec4) 1)', '(blend (vec4) (vec4) (vec4))']) assert.throws(() => shader(`(sh () (return ${expression}))`), SyntaxError);
});
