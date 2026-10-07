import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../engine/compiler.js';
import { forms } from '../engine/forms.js';
import { bindings } from '../engine/bindings.js';

const evaluate = (source, trace = true, extra = {}) => compile(source, { ...bindings, ...extra }, forms, { trace }).run();
const close = (actual, expected) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 0.00001, `${actual} != ${expected}`));
};

test('affine transforms points and discards the homogeneous result without division', () => {
  for (const trace of [true, false]) {
    close(evaluate('(affine (2d translate (vec2 10 20)) (vec2 2 3))', trace).values, [12, 23]);
    close(evaluate('(affine (3d translate (vec3 10 20 30) scale 2) (vec3 1 2 3))', trace).values, [12, 24, 36]);
    close(evaluate('(affine (2d rotate 1.5707963267948966 scale (vec2 2 3)) (vec2 1 2))', trace).values, [-6, 2]);
    close(evaluate('(affine (mat3 1 0 7 0 1 8 10 20 2) (vec2 2 3))', trace).values, [12, 23]);
    assert.equal(evaluate('(let p (vec2 2 3)) (let a (affine (2d) p)) (set a.x 99) p.x', trace), 2);
    close(evaluate('(let f affine) (f (2d) (vec2 2 3))', trace).values, [2, 3]);
    for (const source of ['(affine)', '(affine (2d))', '(affine (2d) (vec2) 1)', '(affine (2d) (vec3))', '(affine (3d) (vec2))', '(affine (2d) (vec2i))', '(affine (vec3) (vec2))', '(2d position (vec2))', '(3d rotation (vec3))']) {
      assert.throws(() => evaluate(source, trace), Error, source);
    }
  }
});

test('shader affine promotes and truncates float vectors and validates operands', () => {
  const shader = source => compile(`(sh () ${source})`, bindings, forms).shaders[0].wgsl;
  const wgsl = shader('(let a (affine (2d translate (vec2 10 20)) (vec2 1 2))) (let b (affine (3d scale 2) (vec3 1 2 3))) (return (vec4 a b.x 1))');
  assert.match(wgsl, /\* vec3f\(vec2f\(1f, 2f\), 1f\)\)\.xy/);
  assert.match(wgsl, /\* vec4f\(vec3f\(1f, 2f, 3f\), 1f\)\)\.xyz/);
  for (const source of ['(affine)', '(affine (2d))', '(affine (2d) (vec2) 1)', '(affine (2d) (vec3))', '(affine (3d) (vec2))', '(affine (2d) (vec2i))', '(affine (vec3) (vec2))']) {
    assert.throws(() => shader(`(let a ${source}) (return (vec4 1))`), SyntaxError, source);
  }
});

test('project divides by the homogeneous coordinate in both dimensions', () => {
  for (const trace of [true, false]) {
    close(evaluate('(project (2d translate (vec2 10 20)) (vec2 2 3))', trace).values, [12, 23]);
    close(evaluate('(project (mat3 1 0 1 0 1 0 10 20 2) (vec2 2 3))', trace).values, [3, 5.75]);
    close(evaluate('(project (mat4 1 0 0 0 0 1 0 0 0 0 1 1 10 20 30 1) (vec3 2 3 3))', trace).values, [3, 5.75, 8.25]);
    close(evaluate('(let f project) (f (2d) (vec2 2 3))', trace).values, [2, 3]);
    const events = [];
    close(evaluate('(project (nextMatrix) (nextPoint))', trace, {
      nextMatrix: () => { events.push('matrix'); return bindings['2d'](); },
      nextPoint: () => { events.push('point'); return bindings.vec2(2, 3); },
    }).values, [2, 3]);
    assert.deepEqual(events, ['matrix', 'point']);
    const zero = evaluate('(project (mat3 1 0 0 0 1 0 0 0 0) (vec2 1 0))', trace).values;
    assert.equal(zero[0], Infinity); assert.ok(Number.isNaN(zero[1]));
    for (const source of ['(project)', '(project (2d))', '(project (2d) (vec2) 1)', '(project (2d) (vec3))', '(project (3d) (vec2))', '(project (2d) (vec2i))', '(project (vec3) (vec2))', '(apply (2d) (vec2))']) {
      assert.throws(() => evaluate(source, trace), Error, source);
    }
  }
});

test('shader project evaluates multiplication once and divides by z or w', () => {
  const shader = source => compile(`(sh () ${source})`, bindings, forms).shaders[0].wgsl;
  const wgsl = shader('(let a (project (2d) (vec2 1 2))) (let b (project (3d) (vec3 1 2 3))) (return (vec4 a b.x 1))');
  assert.match(wgsl, /homogeneous\.xy \/ homogeneous\.z/);
  assert.match(wgsl, /homogeneous\.xyz \/ homogeneous\.w/);
  assert.equal((wgsl.match(/let homogeneous = transform \*/g) || []).length, 2);
  for (const source of ['(project)', '(project (2d))', '(project (2d) (vec2) 1)', '(project (2d) (vec3))', '(project (3d) (vec2))', '(project (2d) (vec2i))', '(project (vec3) (vec2))']) {
    assert.throws(() => shader(`(let a ${source}) (return (vec4 1))`), SyntaxError, source);
  }
});

test('transform defaults are independent mutable identity matrices', () => {
  for (const trace of [true, false]) for (const [name, size] of [['2d', 3], ['3d', 4]]) {
    const value = evaluate(`(${name})`, trace);
    assert.equal(value.type, `mat${size}x${size}f`);
    assert.deepEqual(value.values, Array.from({ length: size * size }, (_, i) => +(i % (size + 1) === 0)));
    assert.equal(evaluate(`(let a (${name})) (let b (${name})) (set a.0.0 2) b.0.0`, trace), 1);
  }
});

test('named transforms compose scale, skew, rotate, translation with any parameter order', () => {
  for (const trace of [true, false]) {
    close(evaluate('(* (2d translate (vec2 10 20)) (vec3 2 3 1))', trace).values, [12, 23, 1]);
    close(evaluate('(* (2d translate (vec2 10 20)) (vec3 2 3 0))', trace).values, [2, 3, 0]);
    close(evaluate('(* (2d rotate 1.5707963267948966 scale (vec2 2 3) translate (vec2 10 20)) (vec3 1 2 1))', trace).values, [4, 22, 1]);
    close(evaluate('(* (2d skew (vec2 0.7853981633974483 0) scale 2) (vec3 1 2 1))', trace).values, [6, 4, 1]);
    const pairs = ['translate (vec3 10 20 30)', 'scale (vec3 2 3 4)', 'rotate (vec3 0.1 0.2 0.3)', 'skew (array (f32) 0.1 0.2 0.3 0.4 0.5 0.6)'];
    assert.deepEqual(evaluate(`(3d ${pairs.join(' ')})`, trace).values, evaluate(`(3d ${pairs.reverse().join(' ')})`, trace).values);
    close(evaluate('(* (3d translate (vec3 10 20 30) scale 2) (vec4 1 2 3 1))', trace).values, [12, 24, 36, 1]);
    // X, then Y, then Z: (0,1,0) -> (0,0,1) -> (1,0,0) -> (0,1,0).
    close(evaluate('(* (3d rotate (vec3 1.5707963267948966)) (vec4 0 1 0 1))', trace).values, [0, 1, 0, 1]);
    for (const [slot, expected] of [[0, [3,2,3,1]], [1, [4,2,3,1]], [2, [1,3,3,1]], [3, [1,5,3,1]], [4, [1,2,4,1]], [5, [1,2,5,1]]]) {
      const angles = Array(6).fill(0); angles[slot] = Math.PI / 4;
      close(evaluate(`(* (3d skew (array (f32) ${angles.join(' ')})) (vec4 1 2 3 1))`, trace).values, expected);
    }
    const input = bindings.vec2(3, 4), events = [];
    evaluate('(2d scale (next 2) rotate (next 0) translate (translate))', trace, {
      next: n => { events.push(n); return n; }, translate: () => { events.push('p'); return input; },
    });
    assert.deepEqual(events, [2, 0, 'p']); assert.deepEqual(input.values, [3, 4]);
    close(evaluate('(let make 2d) (make "scale" -2)', trace).values, [-2,0,0,0,-2,0,0,0,1]);
    // A nested struct array is a live view with a nonzero storage offset.
    close(evaluate(`(struct Settings before:vec4 angles:array<f32,6>)
      (let s (Settings before (vec4 99) angles (array (f32 6) 0.7853981633974483)))
      (* (3d skew s.angles) (vec4 1 2 3 1))`, trace).values, [3,2,3,1]);
  }
});

test('transforms reject invalid parameters and non-finite CPU components', () => {
  for (const trace of [true, false]) for (const source of [
    '(2d scale)', '(2d size 2)', '(3d scale 2 scale 3)', '(2d rotate nil)',
    '(2d translate (vec3 1))', '(3d rotate 1)', '(2d skew (vec2i 1))',
    '(3d skew (list 0 0 0 0 0 0))', '(3d skew (array (i32 6)))', '(3d skew (array (f32 5)))',
    '(2d scale bad)', '(3d translate (vec3 bad))',
  ]) assert.throws(() => evaluate(source, trace, { bad: Infinity }), Error, source);
  for (const bad of [NaN, -Infinity, 1e100]) assert.throws(() => evaluate('(2d rotate bad)', true, { bad }), /finite f32/);
  assert.throws(() => evaluate('(2d scale 3e38 skew (vec2 1.5))'), /finite f32 matrix range/);
});

test('shader transform constructors validate named types and emit shared helpers once', () => {
  const shader = source => compile(source, bindings, forms).shaders[0].wgsl;
  const wgsl = shader(`(sh (skew:array<f32,6>)
    (let a (2d scale 2 rotate 0.1 translate (vec2 0.2 0.3) skew (vec2 0.1)))
    (let b (2d)) (let c (3d skew skew))
    (let d (3d "scale" (vec3 2) skew (array (f32 6))))
    (let affine (fn (p:vec3) (return (* (2d) p))))
    (return (vec4 (+ (affine (vec3 1)).x a.0.0 b.0.0 c.0.0 d.0.0))))`);
  assert.equal((wgsl.match(/fn transform2d\(/g) || []).length, 1);
  assert.equal((wgsl.match(/fn transform3d\(/g) || []).length, 1);
  for (const source of ['(2d unknown 1)', '(2d scale)', '(2d rotate (vec2))', '(2d translate (vec2u))', '(3d scale true)', '(3d skew (array (f32 5)))', '(3d skew (many (f32 6)))', '(3d translate (vec3) translate (vec3))']) {
    assert.throws(() => shader(`(sh () (let t ${source}) (return (vec4 1)))`), SyntaxError, source);
  }
  assert.throws(() => shader('(sh (s:array<f32>) (let t (3d skew s)) (return (vec4 1)))'), /six f32/);
});
