import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../engine/compiler.js';
import { forms } from '../engine/forms.js';
import { bindings } from '../engine/bindings.js';
import { dict } from '../engine/data.js';
import { registerTexture } from '../engine/types.js';

function renderer(events) {
  return snapshot => {
    const content = snapshot.runs.map(run => run.text).join(''); events.push(content);
    return dict('texture', registerTexture(Object.freeze({})), 'w', content.length * 8 + 2, 'h', 20,
      'baseline', 15, 'lines', 1, 'origin', dict('x', 1, 'y', 1));
  };
}

test('named and inline text are hoisted once at shader creation with hidden textures and bounds', () => {
  for (const trace of [true, false]) {
    const builds = [], calls = [];
    const program = compile(`(let name "Ada")
      (let draw (sh (gain:f32)
        (let label (text (span "Hello ") (color (vec3 1 0 0)) (span name)))
        (let uv (/ (- xy label.origin) (vec2 label.w label.h)))
        (let a (sample label uv)) (let b (sample label.texture uv))
        (let c (sample (text (span "Inline")) uv))
        (return (* (+ a b c) gain))))
      (set name "Changed") (draw nil 1) (draw nil 2) draw`, bindings, forms, { trace, textRenderer: renderer(builds) });
    const draw = program.run([(context, ...args) => { calls.push(args); return null; }]);
    assert.deepEqual(builds, ['Hello Ada', 'Inline']); assert.equal(calls.length, 2);
    assert.equal(calls[0].length, 7); assert.equal(calls[0][0], 1); assert.equal(calls[1][0], 2);
    assert.deepEqual(calls[0][2].values, [74, 20, 15, 1]); assert.deepEqual(calls[0][3].values, [1, 1]);
    assert.equal(calls[0][1], calls[1][1]);
    assert.throws(() => draw(null), /expects 1/); assert.throws(() => draw(null, 1, 2), /expects 1/);
    const descriptor = program.shaders[0];
    assert.equal(descriptor.parameterCount, 1); assert.equal(descriptor.uniformCount, 5);
    assert.equal(descriptor.resources.length, 2); assert.equal(descriptor.uniforms.length, 7);
    assert.match(descriptor.wgsl, /textureSampleLevel\(resource0/);
    assert.match(descriptor.wgsl, /textureSampleLevel\(resource1/);
    assert.doesNotMatch(descriptor.wgsl, /Hello|Inline|span\(/);
  }
});

test('hoisted text inside helpers and aliases stays a shader resource', () => {
  const events = [];
  const program = compile(`(let name "Host") (sh ()
    (let label (text (span name))) (let alias label)
    (let read (fn () (return (sample alias (/ xy (vec2 (get alias "w") alias.h))))))
    (let second (fn () (return (sample (text (span "Helper")) (vec2 0.5)))))
    (return (+ (read) (second) (vec4 alias.baseline alias.lines alias.origin.x 1))))`, bindings, forms,
  { textRenderer: renderer(events) });
  const draw = program.run([() => null]); draw(null);
  assert.deepEqual(events, ['Host', 'Helper']); assert.equal(program.shaders[0].resources.length, 2);
  assert.match(program.shaders[0].wgsl, /fn helper/);
});

test('hoisting honors regular text scopes and rejects dependencies on shader-only values', () => {
  for (const text of [...['xy', 'x', 'y', 'uv', 'u', 'v', 'wh', 'w', 'h', 't'].map(name => `(span (str ${name}))`), '(span (str gain))', '(span (str local))']) {
    assert.throws(() => compile(`(let gain "host") (sh (gain:f32) (let local 1)
      (return (sample (text ${text}) (vec2 0.5))))`, bindings, forms), error => /Hoisted text cannot depend/.test(error.message) && Boolean(error.lisp));
  }
  assert.throws(() => compile('(sh () (let f (fn (x:f32) (return (sample (text (span (str x))) (vec2))))) (return (f 1)))', bindings, forms), /shader value x/);
  const builds = [];
  const program = compile('(sh () (return (sample (text (let xy "Local text") (span xy)) (vec2))))', bindings, forms, { textRenderer: renderer(builds) });
  program.run([() => null]); assert.deepEqual(builds, ['Local text']);
  for (const expression of ['(bool label)', '(copy label)', '(get label "content")', '(+ label 1)']) {
    assert.throws(() => compile(`(sh () (let label (text (span "x"))) (let result ${expression}) (return (vec4 1)))`, bindings, forms), SyntaxError);
  }
});

test('each evaluation rebuilds captures, repeated compiler visits share a hoist, and nested shaders have distinct indices', () => {
  const builds = [];
  const program = compile(`(let name "first")
    (let make (fn () (return (sh ()
      (let label (text (let unused (sh () (return (vec4 1)))) (span name)))
      (return (vec4 (% label.w 2)))))))
    (let a (make)) (set name "second") (let b (make)) (list a b)`, bindings, forms, { textRenderer: renderer(builds) });
  assert.equal(program.shaders.length, 2); assert.equal(program.shaders[0].resources.length, 1);
  const calls = [];
  const values = program.run([(...args) => { calls.push(args); }, () => null]).values;
  values[0](null); values[1](null);
  assert.deepEqual(builds, ['first', 'second']); assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(call => call[2].values[0]), [42, 50]);
});

test('text definitions execute in source order even when helpers are compiled lazily', () => {
  const builds = [];
  const program = compile(`(sh ()
    (let helper (fn () (return (sample (text (span "first")) (vec2)))))
    (let last (sample (text (span "second")) (vec2)))
    (return (+ last (helper))))`, bindings, forms, { textRenderer: renderer(builds) });
  let values;
  program.run([(context, ...args) => { values = args; }])(null);
  assert.deepEqual(builds, ['first', 'second']);
  // Binding discovery can differ from evaluation order; both remain paired correctly.
  assert.deepEqual([values[1].values[0], values[4].values[0]], [50, 42]);
});

test('automatic before follows hidden text inputs without changing the shader call signature', () => {
  const builds = [];
  const program = compile('(sh (gain:f32) (let label (text (span "x"))) (return (* (+ (sample before uv) (sample label uv)) gain)))', bindings, forms,
    { textRenderer: renderer(builds) });
  let args;
  const draw = program.run([(context, ...values) => { args = values; }]); draw(null, 2);
  assert.equal(args.length, 4); assert.equal(args[0], 2);
  assert.equal(program.shaders[0].uniforms.length, 5);
  assert.equal(program.shaders[0].uniforms.at(-1).automatic, true);
  assert.deepEqual(builds, ['x']);
  assert.throws(() => compile('(sh () (return (sample (text (span (str before))) uv)))', bindings, forms), /shader value before/);
});
