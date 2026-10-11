import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Compiler } from "../compiler.js";
import { Forms } from "../forms.js";
import { Bindings } from "../bindings.js";
import { Data } from "../data.js";
import { Types } from "../types.js";

function renderer(events) {
  return snapshot => {
    const content = snapshot.runs.map(run => run.text).join(''); events.push(content);
    return Data.dict('texture', Types.registerTexture(Object.freeze({})), 'w', content.length * 8 + 2, 'h', 20,
      'baseline', 15, 'lines', 1, 'origin', Data.dict('x', 1, 'y', 1));
  };
}

test('sample defaults to text UV for hoisted text and inside helpers', () => {
  const events = [];
  const program = Compiler.compile('(sh () (let label (text "M")) (let read (fn () (return (sample label)))) (return (blend (read))))', Bindings, Forms, { textRenderer: renderer(events) });
  assert.match(program.shaders[0].wgsl, /shaderSampler, \(xy \/ bitcast<vec4f>\(frame\.values\[\d+\]\)\.xy\), 0\.0f/);
  Compiler.run(program, [() => null]); assert.deepEqual(events, ['M']);
});

test('text uv uses current pixel coordinates and dimensions inside shaders and helpers', () => {
  for (const trace of [true, false]) {
    const events = [];
    const program = Compiler.compile(`(sh ()
      (let label (text "Hello World"))
      (let uv (vec2 99))
      (let paint (fn () (return (sample label label.uv))))
      (let direct (sample label (get label."uv")))
      (return (blend (paint) direct)))`, Bindings, Forms, { trace, textRenderer: renderer(events) });
    assert.match(program.shaders[0].wgsl, /\(xy \/ bitcast<vec4f>\(frame\.values\[\d+\]\)\.xy\)/);
    assert.match(program.shaders[0].wgsl, /shaderPixel: vec2f/);
    assert.match(program.shaders[0].wgsl, /let xy = shaderPixel/);
    Compiler.run(program, [() => null]);
    assert.deepEqual(events, ['Hello World']);
  }
});

test('text wh works in a render callback with bare strings and implicit blend', () => {
  for (const trace of [true, false]) {
    const events = [], draws = [];
    const source = `(on render (context) {
      (clear)
      ((sh () {
        (let label (text "Hello World"))
        (return (blend (sample label (/ xy label.wh))))
      }) context)
    })`;
    const program = Compiler.compileScene(source, { ...Bindings, clear: () => events.push('clear') }, Forms, { trace, textRenderer: renderer(events) });
    const scene = Compiler.run(program, [(...args) => draws.push(args)]);
    scene.render(null);
    assert.deepEqual(events, ['clear', 'Hello World']);
    assert.equal(draws.length, 1);
    assert.match(program.shaders[0].wgsl, /\.xy/);
    assert.equal(program.shaders[0].resources.some(resource => resource.name === 'before'), true);
    assert.doesNotThrow(() => Compiler.compile('(sh () (let label (text "M")) (return (vec4 (get label."wh") 0 1)))', Bindings, Forms, { textRenderer: renderer([]) }));
  }
});

test('blend samples hoisted text in either position at screen UV', () => {
  for (const operands of ['label', 'label (vec4 1)', '(vec4 1) label', 'label label.texture']) {
    const events = [];
    const program = Compiler.compile(`(sh () (let label (text "M")) (return (blend ${operands})))`, Bindings, Forms, { textRenderer: renderer(events) });
    const descriptor = program.shaders[0];
    assert.equal(descriptor.hasSampler, true);
    assert.equal(descriptor.resources.some(resource => resource.name === 'before'), operands === 'label');
    assert.match(descriptor.wgsl, /textureSampleLevel\([^,]+, shaderSampler, uv, 0f\)/);
    assert.equal((descriptor.wgsl.match(/textureSampleLevel\(/g) || []).length, ['label', 'label label.texture'].includes(operands) ? 2 : 1);
    Compiler.run(program, [() => null]);
    assert.deepEqual(events, ['M']);
  }
});

test('named and inline text are hoisted once at shader creation with hidden textures and bounds', () => {
  for (const trace of [true, false]) {
    const builds = [], calls = [];
    const program = Compiler.compile(`(let name "Ada")
      (let draw (sh (gain:f32)
        (let label (text "Hello " (fill (vec3 1 0 0)) $"{name}"))
        (let uv (/ (- xy label.origin) (vec2 label.w label.h)))
        (let a (sample label uv)) (let b (sample label.texture uv))
        (let c (sample (text (span "Inline")) uv))
        (return (* (+ a b c) gain))))
      (set name "Changed") (draw nil 1) (draw nil 2) draw`, Bindings, Forms, { trace, textRenderer: renderer(builds) });
    const draw = Compiler.run(program, [(context, ...args) => { calls.push(args); return null; }]);
    assert.deepEqual(builds, ['Hello Ada', 'Inline']); assert.equal(calls.length, 2);
    assert.equal(calls[0].length, 7); assert.equal(calls[0][0], 1); assert.equal(calls[1][0], 2);
    assert.deepEqual(Data.values(calls[0][2]), [74, 20, 15, 1]); assert.deepEqual(Data.values(calls[0][3]), [1, 1]);
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
  const program = Compiler.compile(`(let name "Host") (sh ()
    (let label (text (span name))) (let alias label)
    (let read (fn () (return (sample alias (/ xy (vec2 (get alias."w") alias.h))))))
    (let second (fn () (return (sample (text (span "Helper")) (vec2 0.5)))))
    (return (+ (read) (second) (vec4 alias.baseline alias.lines alias.origin.x 1))))`, Bindings, Forms,
  { textRenderer: renderer(events) });
  const draw = Compiler.run(program, [() => null]); draw(null);
  assert.deepEqual(events, ['Host', 'Helper']); assert.equal(program.shaders[0].resources.length, 2);
  assert.match(program.shaders[0].wgsl, /fn helper/);
});

test('hoisting honors regular text scopes and rejects dependencies on shader-only values', () => {
  for (const text of [...['xy', 'x', 'y', 'uv', 'u', 'v', 'wh', 'w', 'h', 't'].map(name => `(span (str ${name}))`), '(span (str gain))', '(span (str local))']) {
    assert.throws(() => Compiler.compile(`(let gain "host") (sh (gain:f32) (let local 1)
      (return (sample (text ${text}) (vec2 0.5))))`, Bindings, Forms), error => /Hoisted text cannot depend/.test(error.message) && Boolean(error.lisp));
  }
  assert.throws(() => Compiler.compile('(sh () (let f (fn (x:f32) (return (sample (text (span (str x))) (vec2))))) (return (f 1)))', Bindings, Forms), /shader value x/);
  const builds = [];
  const program = Compiler.compile('(sh () (return (sample (text (let xy "Local text") (span xy)) (vec2))))', Bindings, Forms, { textRenderer: renderer(builds) });
  Compiler.run(program, [() => null]); assert.deepEqual(builds, ['Local text']);
  for (const expression of ['(bool label)', '(copy label)', '(get label."content")', '(+ label 1)']) {
    assert.throws(() => Compiler.compile(`(sh () (let label (text (span "x"))) (let result ${expression}) (return (vec4 1)))`, Bindings, Forms), SyntaxError);
  }
});

test('each evaluation rebuilds captures, repeated compiler visits share a hoist, and nested shaders have distinct indices', () => {
  const builds = [];
  const program = Compiler.compile(`(let name "first")
    (let make (fn () (return (sh ()
      (let label (text (let unused (sh () (return (vec4 1)))) (span name)))
      (return (vec4 (% label.w 2)))))))
    (let a (make)) (set name "second") (let b (make)) (list a b)`, Bindings, Forms, { textRenderer: renderer(builds) });
  assert.equal(program.shaders.length, 2); assert.equal(program.shaders[0].resources.length, 1);
  const calls = [];
  const values = Data.values(Compiler.run(program, [(...args) => { calls.push(args); }, () => null]));
  values[0](null); values[1](null);
  assert.deepEqual(builds, ['first', 'second']); assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(call => Data.values(call[2])[0]), [42, 50]);
});

test('text definitions execute in source order even when helpers are compiled lazily', () => {
  const builds = [];
  const program = Compiler.compile(`(sh ()
    (let helper (fn () (return (sample (text (span "first")) (vec2)))))
    (let last (sample (text (span "second")) (vec2)))
    (return (+ last (helper))))`, Bindings, Forms, { textRenderer: renderer(builds) });
  let values;
  Compiler.run(program, [(context, ...args) => { values = args; }])(null);
  assert.deepEqual(builds, ['first', 'second']);
  // Binding discovery can differ from evaluation order; both remain paired correctly.
  assert.deepEqual([Data.values(values[1])[0], Data.values(values[4])[0]], [50, 42]);
});

test('automatic before follows hidden text inputs without changing the shader call signature', () => {
  const builds = [];
  const program = Compiler.compile('(sh (gain:f32) (let label (text (span "x"))) (return (* (+ (sample before uv) (sample label uv)) gain)))', Bindings, Forms,
    { textRenderer: renderer(builds) });
  let args;
  const draw = Compiler.run(program, [(context, ...values) => { args = values; }]); draw(null, 2);
  assert.equal(args.length, 4); assert.equal(args[0], 2);
  assert.equal(program.shaders[0].uniforms.length, 5);
  assert.equal(program.shaders[0].uniforms.at(-1).automatic, true);
  assert.deepEqual(builds, ['x']);
  assert.throws(() => Compiler.compile('(sh () (return (sample (text (span (str before))) uv)))', Bindings, Forms), /shader value before/);
});
