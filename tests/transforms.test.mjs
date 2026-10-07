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

test('transform defaults are independent mutable identity matrices', () => {
  for (const trace of [true, false]) for (const [name, size] of [['2d', 3], ['3d', 4]]) {
    const value = evaluate(`(${name})`, trace);
    assert.equal(value.type, `mat${size}x${size}f`);
    assert.deepEqual(value.values, Array.from({ length: size * size }, (_, i) => +(i % (size + 1) === 0)));
    assert.equal(evaluate(`(let a (${name})) (let b (${name})) (set a.0.0 2) b.0.0`, trace), 1);
  }
});

test('named transforms compose scale, skew, rotation, translation with any parameter order', () => {
  for (const trace of [true, false]) {
    close(evaluate('(* (2d position (vec2 10 20)) (vec3 2 3 1))', trace).values, [12, 23, 1]);
    close(evaluate('(* (2d position (vec2 10 20)) (vec3 2 3 0))', trace).values, [2, 3, 0]);
    close(evaluate('(* (2d rotation 1.5707963267948966 scale (vec2 2 3) position (vec2 10 20)) (vec3 1 2 1))', trace).values, [4, 22, 1]);
    close(evaluate('(* (2d skew (vec2 0.7853981633974483 0) scale 2) (vec3 1 2 1))', trace).values, [6, 4, 1]);
    const pairs = ['position (vec3 10 20 30)', 'scale (vec3 2 3 4)', 'rotation (vec3 0.1 0.2 0.3)', 'skew (array (f32) 0.1 0.2 0.3 0.4 0.5 0.6)'];
    assert.deepEqual(evaluate(`(3d ${pairs.join(' ')})`, trace).values, evaluate(`(3d ${pairs.reverse().join(' ')})`, trace).values);
    close(evaluate('(* (3d position (vec3 10 20 30) scale 2) (vec4 1 2 3 1))', trace).values, [12, 24, 36, 1]);
    // X, then Y, then Z: (0,1,0) -> (0,0,1) -> (1,0,0) -> (0,1,0).
    close(evaluate('(* (3d rotation (vec3 1.5707963267948966)) (vec4 0 1 0 1))', trace).values, [0, 1, 0, 1]);
    for (const [slot, expected] of [[0, [3,2,3,1]], [1, [4,2,3,1]], [2, [1,3,3,1]], [3, [1,5,3,1]], [4, [1,2,4,1]], [5, [1,2,5,1]]]) {
      const angles = Array(6).fill(0); angles[slot] = Math.PI / 4;
      close(evaluate(`(* (3d skew (array (f32) ${angles.join(' ')})) (vec4 1 2 3 1))`, trace).values, expected);
    }
    const input = bindings.vec2(3, 4), events = [];
    evaluate('(2d scale (next 2) rotation (next 0) position (position))', trace, {
      next: n => { events.push(n); return n; }, position: () => { events.push('p'); return input; },
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
    '(2d scale)', '(2d size 2)', '(3d scale 2 scale 3)', '(2d rotation nil)',
    '(2d position (vec3 1))', '(3d rotation 1)', '(2d skew (vec2i 1))',
    '(3d skew (list 0 0 0 0 0 0))', '(3d skew (array (i32 6)))', '(3d skew (array (f32 5)))',
    '(2d scale bad)', '(3d position (vec3 bad))',
  ]) assert.throws(() => evaluate(source, trace, { bad: Infinity }), Error, source);
  for (const bad of [NaN, -Infinity, 1e100]) assert.throws(() => evaluate('(2d rotation bad)', true, { bad }), /finite f32/);
  assert.throws(() => evaluate('(2d scale 3e38 skew (vec2 1.5))'), /finite f32 matrix range/);
});

test('shader transform constructors validate named types and emit shared helpers once', () => {
  const shader = source => compile(source, bindings, forms).shaders[0].wgsl;
  const wgsl = shader(`(sh (skew:array<f32,6>)
    (let a (2d scale 2 rotation 0.1 position (vec2 0.2 0.3) skew (vec2 0.1)))
    (let b (2d)) (let c (3d skew skew))
    (let d (3d "scale" (vec3 2) skew (array (f32 6))))
    (let apply (fn (p:vec3) (return (* (2d) p))))
    (return (vec4 (+ (apply (vec3 1)).x a.0.0 b.0.0 c.0.0 d.0.0))))`);
  assert.equal((wgsl.match(/fn transform2d\(/g) || []).length, 1);
  assert.equal((wgsl.match(/fn transform3d\(/g) || []).length, 1);
  for (const source of ['(2d unknown 1)', '(2d scale)', '(2d rotation (vec2))', '(2d position (vec2u))', '(3d scale true)', '(3d skew (array (f32 5)))', '(3d skew (many (f32 6)))', '(3d position (vec3) position (vec3))']) {
    assert.throws(() => shader(`(sh () (let t ${source}) (return (vec4 1)))`), SyntaxError, source);
  }
  assert.throws(() => shader('(sh (s:array<f32>) (let t (3d skew s)) (return (vec4 1)))'), /six f32/);
});
