import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, read } from '../engine/compiler.js';
import { compileShader } from '../engine/shader.js';
import { forms } from '../engine/forms.js';

const shader = source => compileShader(read(source)[0], source);

test('scalar modulo compiles to WGSL remainder with strict arity and types', () => {
  const result = shader('(sh (value:f32 divisor:f32) (return (vec4f (% value divisor) (% -7 3) 0 1)))');
  assert.match(result.wgsl, /bitcast<f32>\(frame.values\[0\].x\) % bitcast<f32>\(frame.values\[1\].x\)/);
  assert.match(result.wgsl, /\(-7f % 3f\)/);
  for (const expression of ['(%)', '(% 1)', '(% 1 2 3)', '(% (vec2f 1) 2)', '(% (mat2x2f 1 0 0 1) 2)', '(% true 2)']) {
    const source = `(sh () (return (vec4f ${expression})))`;
    assert.throws(() => shader(source), error => error instanceof SyntaxError && Boolean(error.lisp));
  }
});

test('square matrix uniforms, constructors, helpers, and products compile with numeric types', () => {
  for (const size of [2, 3, 4]) {
    const source = `(sh (offset:f32 transform:mat${size}x${size}f after:vec2f)
      (let identity (mat${size}x${size}f ${Array.from({ length: size * size }, (_, i) => i % (size + 1) === 0 ? 1 : 0).join(" ")}))
      (let apply (fn (m:mat${size}x${size}f v:vec${size}f) (return (* m v))))
      (let combined (* transform identity))
      (let result (apply (copy combined) (vec${size}f 0.5)))
      (return (vec4f result.x after 1)))`;
    const result = shader(source);
    assert.equal(result.uniformCount, size + 2);
    assert.deepEqual(result.uniforms.map(value => value.slot), [0, 1, size + 1]);
    assert.match(result.wgsl, new RegExp(`mat${size}x${size}f`));
    assert.match(result.wgsl, new RegExp(`frame.values\\[${size}\\].${'xyzw'.slice(0, size)}`));
    assert.doesNotMatch(result.wgsl, /fn diagonal/);
    assert.match(result.wgsl, new RegExp(`argument0: mat${size}x${size}f, argument1: vec${size}f`));
    shader(`(sh () (let m (mat${size}x${size}f ${Array.from({ length: size }, () => `(vec${size}f 1)`).join(' ')}))
      (let n (- (+ m m))) (let v (* (vec${size}f 1) (* 2 n))) (return (vec4f v.x)))`);
    shader(`(sh () (let m (mat${size}x${size}f ${Array(size * size).fill(1).join(' ')}))
      (let make (fn () (return (mat${size}x${size}f ${Array.from({ length: size * size }, (_, i) => i % (size + 1) === 0 ? 1 : 0).join(" ")})))) (return (vec4f 1)))`);
  }
  for (const source of [
    '(sh () (let m (mat2x2f 1 2)) (return (vec4f 1)))',
    '(sh () (let m (mat2x2f (vec3f 1) (vec3f 1))) (return (vec4f 1)))',
    '(sh () (return (vec4f (+ (mat2x2f 1 0 0 1) 1))))',
    '(sh () (return (vec4f (* (mat2x2f 1 0 0 1) (vec3f 1)))))',
    '(sh () (return (vec4f (/ (mat2x2f 1 0 0 1) 2))))',
    '(sh () (return (vec4f (mat2x2f 1 0 0 1).x)))',
    '(sh () (return (vec4f (mat2x2f 1 0 0 1))))',
    '(sh () (return (vec4f (copy 1 2))))',
  ]) assert.throws(() => shader(source), error => error instanceof SyntaxError && Boolean(error.lisp));
});

test('gradient compiles to typed WGSL with built-in frame inputs', () => {
  const result = shader('(sh () (let uv (/ xy (vec2f w h))) (return (vec4f uv 0 1)))');
  assert.deepEqual(result.uniforms, []);
  assert.match(result.wgsl, /var local0: vec2f = \(xy \/ vec2f\(w, h\)\)/);
  assert.match(result.wgsl, /return vec4f\(local0, 0f, 1f\)/);
  for (const name of ['xy', 'x', 'y', 'uv', 'u', 'v', 'wh', 'w', 'h', 't', 'dt']) assert.match(result.wgsl, new RegExp(`let ${name}\\s+=`));
});

test('coordinate builtins have the correct types, remain read-only, and replace p', () => {
  const result = shader('(sh () (return (vec4 (+ xy uv wh) (+ x y u v w h) 1)))');
  assert.deepEqual(result.uniforms, []);
  assert.match(result.wgsl, /let uv = xy \/ wh/);
  assert.match(result.wgsl, /let wh = frame.data.xy/);
  assert.doesNotMatch(result.wgsl, /let p =/);
  for (const name of ['xy', 'uv', 'wh', 'x', 'y', 'u', 'v', 'w', 'h']) {
    const vector = ['xy', 'uv', 'wh'].includes(name);
    assert.throws(() => shader(`(sh (${name}:${vector ? 'vec2' : 'f32'}) (return (vec4 1)))`), /Invalid or duplicate shader parameter/);
    assert.throws(() => shader(`(sh () (set ${name} ${vector ? '(vec2)' : '0'}) (return (vec4 1)))`), /Cannot assign shader input/);
  }
  assert.throws(() => shader('(sh () (return (vec4 p 0 1)))'), /Unknown shader symbol: p/);
  // The old name remains available as an ordinary user parameter.
  assert.equal(shader('(sh (p:vec2) (return (vec4 p 0 1)))').uniforms[0].name, 'p');
});

test('before is an automatic texture input available in shader helpers', () => {
  const result = shader('(sh (gain:f32) (let read (fn () (return (sample before uv)))) (return (* (read) gain)))');
  assert.equal(result.parameterCount, 1);
  assert.equal(result.uniformCount, 1);
  assert.equal(result.resources.length, 1);
  assert.equal(result.uniforms.at(-1).automatic, true);
  assert.match(result.wgsl, /@binding\(1\) var before: texture_2d<f32>/);
  assert.match(result.wgsl, /textureSampleLevel\(before, shaderSampler/);
  assert.equal(shader('(sh () (return (vec4 1)))').resources.length, 0);
  assert.throws(() => shader('(sh (before:texture2d) (return (sample before uv)))'), /Invalid or duplicate shader parameter/);
  assert.throws(() => shader('(sh () (set before 0) (return (vec4 1)))'), /Cannot assign shader input/);
});

test('shader locals, assignment, scopes, scalar broadcasting, and swizzles', () => {
  const result = shader('(sh () (let uv (/ xy (vec2f w h))) { (let uv (vec2f 0)) (set uv (+ uv 1)) } (set uv (* uv 0.5)) (return (vec4f uv.x uv.y 0 1)))');
  assert.match(result.wgsl, /var local1: vec2f/);
  assert.match(result.wgsl, /vec2f\(1f\)/);
  assert.match(result.wgsl, /local0 = \(local0 \* vec2f\(0.5f\)\)/);
});

test('typed scalar uniforms are declared separately from built-in inputs', () => {
  const result = shader('(sh (gain:f32) (return (vec4f gain t dt 1)))');
  assert.deepEqual(result.uniforms, [{ name: 'gain', type: 'f32', slot: 0 }]);
  assert.match(result.wgsl, /values: array<vec4u, 1>/);
  assert.match(result.wgsl, /frame.values\[0\].x/);
});

test('shader vector uniforms and texture resources have distinct typed bindings', () => {
  const result = shader('(sh (image:texture2d tint:vec4f gain:f32) (return (* (sample image (/ xy (vec2f w h))) tint gain)))');
  assert.equal(result.uniformCount, 2);
  assert.equal(result.resources.length, 1);
  assert.equal(result.resources[0].binding, 1);
  assert.match(result.wgsl, /values: array<vec4u, 2>/);
  assert.match(result.wgsl, /var resource0: texture_2d<f32>/);
  assert.match(result.wgsl, /var shaderSampler: sampler/);
  assert.match(result.wgsl, /textureSampleLevel\(resource0, shaderSampler/);
  assert.match(result.wgsl, /frame.values\[0\].xyzw/);
  assert.match(result.wgsl, /frame.values\[1\].x/);
});

test('helpers accept texture resources and shader assertions are checked statically', () => {
  const result = shader('(sh (image:texture2d) (let read (fn (input:texture2d uv:vec2f) (return (sample input uv)))) (return (read image ((/ xy (vec2f w h)) : vec2f))))');
  assert.match(result.wgsl, /argument0: texture_2d<f32>, argument1: vec2f/);
  assert.doesNotMatch(result.wgsl, /var local\d+: texture/);
  assert.equal(shader('(sh () (let read (fn (input:texture2d) (return (sample input xy)))) (return (vec4f 1)))').hasSampler, true);
  for (const source of [
    '(sh (image:texture2d) (return (vec4f image)))',
    '(sh (image:texture2d) (return (+ image 1)))',
    '(sh (image:texture2d) (return (sample image 1)))',
    '(sh () (return (vec4f (sample 1 xy))))',
    '(sh () (return ((vec4f 1) : f32)))',
  ]) assert.throws(() => shader(source), SyntaxError);
});

test('colon annotations accept whitespace, newlines, and comments on either side', () => {
  const layouts = [':', ': ', ' :', ' : ', '\n:\n', ' ; before colon\n : ; after colon\n '];
  let expected;
  for (const separator of layouts) {
    const result = shader(`(sh (gain${separator}f32)
      (let color (fn (uv${separator}vec2f amount${separator}f32)
        (return (vec4f (* uv amount) 0 1))))
      (return (color (/ xy (vec2f w h)) gain)))`);
    expected ??= result.wgsl;
    assert.equal(result.wgsl, expected);
  }
});

test('malformed colon annotations and old tuple notation report source errors', () => {
  for (const parameters of ['uv vec2f', 'uv:', ':vec2f', 'uv::vec2f', 'uv:bogus', 'uv:f32:vec2f', '(uv vec2f)', 'uv:vec2f uv:vec2f']) {
    const source = `(sh () (let color (fn (${parameters}) (return (vec4f 1)))) (return (vec4f 1)))`;
    assert.throws(() => shader(source), error => error instanceof SyntaxError && Boolean(error.lisp), parameters);
  }
  assert.throws(() => shader('(sh (gain:bogus) (return (vec4f 1)))'), /Unsupported parameter type/);
});

test('colon is syntax outside strings and comments; scene functions accept optional types', () => {
  const nodes = read('uv : vec2f');
  assert.deepEqual(nodes.map(node => node.kind), ['symbol', 'colon', 'symbol']);
  assert.equal(nodes[1].start, 3);
  assert.equal(read('"https://example.com"')[0].value, 'https://example.com');
  assert.equal(read('; name:type\n42')[0].value, 42);
  assert.equal(compile('f"name:type"', {}, forms).run(), 'name:type');
  assert.throws(() => compile(':', {}, forms), /Colon annotations/);
  assert.equal(compile('((fn (value:f32) (return value)) 42)', {}, forms).run(), 42);
});

test('inline shader values are stable across repeated callback execution', () => {
  for (const trace of [true, false]) {
    const seen = [];
    const program = compile('(on render (context) (record (sh () (return (vec4f 1)))))',
      { record: value => seen.push(value) }, forms, { trace, scene: true });
    const value = () => {};
    const scene = program.run([value]);
    scene.render({}); scene.render({}); scene.render({});
    assert.equal(program.shaders.length, 1);
    assert.deepEqual(seen, [value, value, value]);
  }
});

test('let-bound helpers lift to module scope with inferred return types', () => {
  const result = shader('(sh () (let gradient (fn (uv:vec2f) (return (vec4f uv 0 1)))) (return (gradient (/ xy (vec2f w h)))))');
  assert.match(result.wgsl, /fn helper0\(shaderPixel: vec2f, argument0: vec2f\) -> vec4f/);
  assert.ok(result.wgsl.indexOf('fn helper0') < result.wgsl.indexOf('@fragment'));
  assert.match(result.wgsl, /return helper0\(xy, \(xy \/ vec2f\(w, h\)\)\)/);
  assert.doesNotMatch(result.wgsl, /var \w+:.*fn/);
});

test('helper parameters are mutable and helpers can return scalars or vectors', () => {
  const result = shader('(sh () (let double (fn (x:f32) (set x (* x 2)) (return x))) (let color (fn (uv:vec2f) (return (vec4f uv (double 0.25) 1)))) (return (color (/ xy (vec2f w h)))))');
  assert.match(result.wgsl, /fn helper0\(shaderPixel: vec2f, argument0: f32\) -> f32/);
  assert.match(result.wgsl, /var local\d+: f32 = argument0/);
  assert.match(result.wgsl, /local\d+ = \(local\d+ \* 2f\)/);
  assert.match(result.wgsl, /helper0\(xy, 0.25f\)/);
});

test('helpers receive built-in pixel inputs and access shader uniforms', () => {
  const result = shader('(sh (gain:f32) (let pixel (fn () (return (* (/ xy (vec2f w h)) gain)))) (return (vec4f (pixel) 0 1)))');
  assert.match(result.wgsl, /fn helper0\(shaderPixel: vec2f\) -> vec2f/);
  assert.match(result.wgsl, /let xy = shaderPixel/);
  assert.match(result.wgsl, /frame.values\[0\].x/);
});

test('nested helpers and shadowed names generate distinct WGSL functions', () => {
  const result = shader(`(sh ()
    (let color (fn () (return (vec4f 0))))
    {
      (let color (fn ()
        (let scalar (fn () (return 0.5)))
        (return (vec4f (scalar)))))
      (return (color))
    })`);
  assert.equal((result.wgsl.match(/fn helper\d+/g) || []).length, 3);
  assert.match(result.wgsl, /return helper1\(xy\)/);
  assert.match(result.wgsl, /helper2\(xy\)/);
});

test('invalid helper calls, captures, recursion, and function values fail with source spans', () => {
  const cases = [
    '(sh () (let helper (fn (uv) (return uv))) (return (vec4f 1)))',
    '(sh () (let helper (fn (v:constructor) (return v))) (return (vec4f 1)))',
    '(sh () (let helper (fn (v:f32 v:f32) (return v))) (return (vec4f 1)))',
    '(sh () (let helper (fn (v:f32) (let v 1) (return v))) (return (vec4f 1)))',
    '(sh () (let helper (fn () (let value 1))) (return (vec4f 1)))',
    '(sh () (let helper (fn (uv:vec2f) (return uv))) (return (vec4f (helper 1) 0 1)))',
    '(sh () (let helper (fn (uv:vec2f) (return uv))) (return (vec4f (helper) 0 1)))',
    '(sh () (let value 1) (let helper (fn () (return value))) (return (vec4f (helper))))',
    '(sh () (let helper (fn () (return (helper)))) (return (vec4f (helper))))',
    '(sh () (let a (fn () (return (b)))) (let b (fn () (return (a)))) (return (vec4f (a))))',
    '(sh () (let helper (fn () (return 1))) (set helper 2) (return (vec4f 1)))',
    '(sh () (let helper (fn () (return 1))) (return (vec4f helper)))',
    '(sh () (let alias ((fn () (return 1)))) (return (vec4f alias)))',
    '(sh () { (let helper (fn () (return 1))) } (return (vec4f (helper))))',
  ];
  for (const source of cases) assert.throws(() => shader(source), error => error instanceof SyntaxError && Boolean(error.lisp), source);
});

test('shader errors have Lisp spans and reject unsupported or mismatched types', () => {
  for (const source of [
    '(sh)', '(sh (gain) (return (vec4f 1)))', '(sh (xy:f32) (return (vec4f 1)))',
    '(sh () (return "red"))', '(sh () (return xy))', '(sh () (let x 1))',
    '(sh () (return (vec4f NaN)))', '(sh () (return (vec4f (print 1))))',
    '(sh () (let x "2") (return (vec4f 1)))', '(sh () (let x x) (return (vec4f 1)))',
    '(sh () (let x 1) (set x (vec2f 1)) (return (vec4f 1)))',
    '(sh () (set t 1) (return (vec4f 1)))', '(sh () (return (vec4f outside)))',
    '(sh () (return (vec4f (+ (vec2f 1) (vec3f 1)) 1)))',
    '(sh () (return (vec4f xy.z)))',
    '(sh () (return (vec4f 1)) (let x 2))',
  ]) {
    assert.throws(() => shader(source), error => error instanceof SyntaxError && Boolean(error.lisp), source);
  }
});
