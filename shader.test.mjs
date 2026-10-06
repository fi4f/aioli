import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, read } from './compiler.js';
import { compileShader } from './shader.js';
import { forms } from './forms.js';

const shader = source => compileShader(read(source)[0], source);

test('gradient compiles to typed WGSL with built-in frame inputs', () => {
  const result = shader('(sh () (let uv (/ p (vec2 w h))) (return (vec4 uv 0 1)))');
  assert.deepEqual(result.uniforms, []);
  assert.match(result.wgsl, /var local0: vec2f = \(p \/ vec2f\(w, h\)\)/);
  assert.match(result.wgsl, /return vec4f\(local0, 0f, 1f\)/);
  for (const name of ['p', 'w', 'h', 't', 'dt']) assert.match(result.wgsl, new RegExp(`let ${name} =`));
});

test('shader locals, assignment, scopes, scalar broadcasting, and swizzles', () => {
  const result = shader('(sh () (let uv (/ p (vec2 w h))) { (let uv (vec2 0)) (set uv (+ uv 1)) } (set uv (* uv 0.5)) (return (vec4 (x uv) (y uv) 0 1)))');
  assert.match(result.wgsl, /var local1: vec2f/);
  assert.match(result.wgsl, /vec2f\(1f\)/);
  assert.match(result.wgsl, /local0 = \(local0 \* vec2f\(0.5f\)\)/);
});

test('typed scalar uniforms are declared separately from built-in inputs', () => {
  const result = shader('(sh (gain:float) (return (vec4 gain t dt 1)))');
  assert.deepEqual(result.uniforms, [{ name: 'gain', type: 'float', slot: 0 }]);
  assert.match(result.wgsl, /values: array<vec4f, 1>/);
  assert.match(result.wgsl, /frame.values\[0\].x/);
});

test('shader vector uniforms and texture resources have distinct typed bindings', () => {
  const result = shader('(sh (image:texture2d tint:vec4 gain:float) (return (* (sample image (/ p (vec2 w h))) tint gain)))');
  assert.equal(result.uniformCount, 2);
  assert.equal(result.resources.length, 1);
  assert.equal(result.resources[0].binding, 1);
  assert.match(result.wgsl, /values: array<vec4f, 2>/);
  assert.match(result.wgsl, /var resource0: texture_2d<f32>/);
  assert.match(result.wgsl, /var shaderSampler: sampler/);
  assert.match(result.wgsl, /textureSampleLevel\(resource0, shaderSampler/);
  assert.match(result.wgsl, /frame.values\[0\].xyzw/);
  assert.match(result.wgsl, /frame.values\[1\].x/);
});

test('helpers accept texture resources and shader assertions are checked statically', () => {
  const result = shader('(sh (image:texture2d) (let read (fn (input:texture2d uv:vec2) (return (sample input uv)))) (return (read image ((/ p (vec2 w h)) : vec2))))');
  assert.match(result.wgsl, /argument0: texture_2d<f32>, argument1: vec2f/);
  assert.doesNotMatch(result.wgsl, /var local\d+: texture/);
  assert.equal(shader('(sh () (let read (fn (input:texture2d) (return (sample input p)))) (return (vec4 1)))').hasSampler, true);
  for (const source of [
    '(sh (image:texture2d) (return (vec4 image)))',
    '(sh (image:texture2d) (return (+ image 1)))',
    '(sh (image:texture2d) (return (sample image 1)))',
    '(sh () (return (vec4 (sample 1 p))))',
    '(sh () (return ((vec4 1) : float)))',
  ]) assert.throws(() => shader(source), SyntaxError);
});

test('colon annotations accept whitespace, newlines, and comments on either side', () => {
  const layouts = [':', ': ', ' :', ' : ', '\n:\n', ' ; before colon\n : ; after colon\n '];
  let expected;
  for (const separator of layouts) {
    const result = shader(`(sh (gain${separator}float)
      (let color (fn (uv${separator}vec2 amount${separator}float)
        (return (vec4 (* uv amount) 0 1))))
      (return (color (/ p (vec2 w h)) gain)))`);
    expected ??= result.wgsl;
    assert.equal(result.wgsl, expected);
  }
});

test('malformed colon annotations and old tuple notation report source errors', () => {
  for (const parameters of ['uv vec2', 'uv:', ':vec2', 'uv::vec2', 'uv:bogus', 'uv:float:vec2', '(uv vec2)', 'uv:vec2 uv:vec2']) {
    const source = `(sh () (let color (fn (${parameters}) (return (vec4 1)))) (return (vec4 1)))`;
    assert.throws(() => shader(source), error => error instanceof SyntaxError && Boolean(error.lisp), parameters);
  }
  assert.throws(() => shader('(sh (gain:bogus) (return (vec4 1)))'), /Unsupported parameter type/);
});

test('colon is syntax outside strings and comments; scene functions accept optional types', () => {
  const nodes = read('uv : vec2');
  assert.deepEqual(nodes.map(node => node.kind), ['symbol', 'colon', 'symbol']);
  assert.equal(nodes[1].start, 3);
  assert.equal(read('"https://example.com"')[0].value, 'https://example.com');
  assert.equal(read('; name:type\n42')[0].value, 42);
  assert.equal(compile('f"name:type"', {}, forms).run(), 'name:type');
  assert.throws(() => compile(':', {}, forms), /Colon annotations/);
  assert.equal(compile('((fn (value:float) (return value)) 42)', {}, forms).run(), 42);
});

test('inline shader values are stable across repeated callback execution', () => {
  for (const debug of [true, false]) {
    const seen = [];
    const program = compile('(on render (context) (record (sh () (return (vec4 1)))))',
      { record: value => seen.push(value) }, forms, { debug, scene: true });
    const value = () => {};
    const scene = program.run([value]);
    scene.render({}); scene.render({}); scene.render({});
    assert.equal(program.shaders.length, 1);
    assert.deepEqual(seen, [value, value, value]);
  }
});

test('let-bound helpers lift to module scope with inferred return types', () => {
  const result = shader('(sh () (let gradient (fn (uv:vec2) (return (vec4 uv 0 1)))) (return (gradient (/ p (vec2 w h)))))');
  assert.match(result.wgsl, /fn helper0\(shaderPixel: vec2f, argument0: vec2f\) -> vec4f/);
  assert.ok(result.wgsl.indexOf('fn helper0') < result.wgsl.indexOf('@fragment'));
  assert.match(result.wgsl, /return helper0\(p, \(p \/ vec2f\(w, h\)\)\)/);
  assert.doesNotMatch(result.wgsl, /var \w+:.*fn/);
});

test('helper parameters are mutable and helpers can return scalars or vectors', () => {
  const result = shader('(sh () (let double (fn (x:float) (set x (* x 2)) (return x))) (let color (fn (uv:vec2) (return (vec4 uv (double 0.25) 1)))) (return (color (/ p (vec2 w h)))))');
  assert.match(result.wgsl, /fn helper0\(shaderPixel: vec2f, argument0: f32\) -> f32/);
  assert.match(result.wgsl, /var local\d+: f32 = argument0/);
  assert.match(result.wgsl, /local\d+ = \(local\d+ \* 2f\)/);
  assert.match(result.wgsl, /helper0\(p, 0.25f\)/);
});

test('helpers receive built-in pixel inputs and access shader uniforms', () => {
  const result = shader('(sh (gain:float) (let pixel (fn () (return (* (/ p (vec2 w h)) gain)))) (return (vec4 (pixel) 0 1)))');
  assert.match(result.wgsl, /fn helper0\(shaderPixel: vec2f\) -> vec2f/);
  assert.match(result.wgsl, /let p = shaderPixel/);
  assert.match(result.wgsl, /frame.values\[0\].x/);
});

test('nested helpers and shadowed names generate distinct WGSL functions', () => {
  const result = shader(`(sh ()
    (let color (fn () (return (vec4 0))))
    {
      (let color (fn ()
        (let scalar (fn () (return 0.5)))
        (return (vec4 (scalar)))))
      (return (color))
    })`);
  assert.equal((result.wgsl.match(/fn helper\d+/g) || []).length, 3);
  assert.match(result.wgsl, /return helper1\(p\)/);
  assert.match(result.wgsl, /helper2\(p\)/);
});

test('invalid helper calls, captures, recursion, and function values fail with source spans', () => {
  const cases = [
    '(sh () (let helper (fn (uv) (return uv))) (return (vec4 1)))',
    '(sh () (let helper (fn (v:constructor) (return v))) (return (vec4 1)))',
    '(sh () (let helper (fn (v:float v:float) (return v))) (return (vec4 1)))',
    '(sh () (let helper (fn (v:float) (let v 1) (return v))) (return (vec4 1)))',
    '(sh () (let helper (fn () (let value 1))) (return (vec4 1)))',
    '(sh () (let helper (fn (uv:vec2) (return uv))) (return (vec4 (helper 1) 0 1)))',
    '(sh () (let helper (fn (uv:vec2) (return uv))) (return (vec4 (helper) 0 1)))',
    '(sh () (let value 1) (let helper (fn () (return value))) (return (vec4 (helper))))',
    '(sh () (let helper (fn () (return (helper)))) (return (vec4 (helper))))',
    '(sh () (let a (fn () (return (b)))) (let b (fn () (return (a)))) (return (vec4 (a))))',
    '(sh () (let helper (fn () (return 1))) (set helper 2) (return (vec4 1)))',
    '(sh () (let helper (fn () (return 1))) (return (vec4 helper)))',
    '(sh () (let alias ((fn () (return 1)))) (return (vec4 alias)))',
    '(sh () { (let helper (fn () (return 1))) } (return (vec4 (helper))))',
  ];
  for (const source of cases) assert.throws(() => shader(source), error => error instanceof SyntaxError && Boolean(error.lisp), source);
});

test('shader errors have Lisp spans and reject unsupported or mismatched types', () => {
  for (const source of [
    '(sh)', '(sh (gain) (return (vec4 1)))', '(sh (p:float) (return (vec4 1)))',
    '(sh () (return "red"))', '(sh () (return p))', '(sh () (let x 1))',
    '(sh () (return (vec4 NaN)))', '(sh () (return (vec4 (print 1))))',
    '(sh () (let x "2") (return (vec4 1)))', '(sh () (let x x) (return (vec4 1)))',
    '(sh () (let x 1) (set x (vec2 1)) (return (vec4 1)))',
    '(sh () (set t 1) (return (vec4 1)))', '(sh () (return (vec4 outside)))',
    '(sh () (return (vec4 (+ (vec2 1) (vec3 1)) 1)))',
    '(sh () (return (vec4 (z p))))',
    '(sh () (return (vec4 1)) (let x 2))',
  ]) {
    assert.throws(() => shader(source), error => error instanceof SyntaxError && Boolean(error.lisp), source);
  }
});
