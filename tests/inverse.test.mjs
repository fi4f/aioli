import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../engine/compiler/compiler.js';
import { bindings } from '../engine/language/bindings.js';
import { forms } from '../engine/compiler/forms.js';
const evaluate = (source, trace, extra = {}) => compile(source, { ...bindings, ...extra }, forms, { trace }).run();
const close = (actual, expected) => actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 0.0001, `${actual} != ${expected}`));

test('inverse supports all square matrices, row pivoting, fresh storage and multiplication identities', () => {
  for (const trace of [true, false]) for (const n of [2,3,4]) {
    const values = Array.from({ length: n * n }, (_, i) => i % (n + 1) === 0 ? 10 + i : (i % 3) - 1);
    const matrix = bindings[`mat${n}`](...values), original = [...matrix.values];
    const result = evaluate('(inverse m)', trace, { m: matrix });
    assert.equal(result.type, matrix.type); assert.notEqual(result, matrix);
    const identity = Array.from({ length: n*n }, (_, i) => +(i % (n+1) === 0));
    close(bindings['*'](matrix,result).values, identity);
    close(bindings['*'](result,matrix).values, identity);
    result.values[0] = 99; assert.deepEqual(matrix.values, original);
    close(evaluate('(let invert inverse) (invert (mat2 0 1 1 0))', trace).values, [0,1,1,0]);
  }
});

test('inverse undoes affine and projective point transforms and evaluates its operand once', () => {
  for (const trace of [true, false]) {
    for (const [matrix, point] of [
      ['(2d translate (vec2 10 20) rotate 0.4 scale (vec2 2 3) skew (vec2 0.1 0.2))','(vec2 2 3)'],
      ['(3d translate (vec3 10 20 30) rotate (vec3 0.1 0.2 0.3) scale 2)','(vec3 2 3 4)'],
      ['(mat3 1 0 0.25 0 1 0 10 20 2)','(vec2 2 3)'],
    ]) {
      const expected = evaluate(point, trace).values;
      close(evaluate(`(let m ${matrix}) (let p ${point}) (transform (inverse m) (transform m p))`, trace).values, expected);
    }
    let calls = 0;
    evaluate('(inverse (next))', trace, { next: () => { calls++; return bindings['2d'](); } });
    assert.equal(calls, 1);
    for (const source of ['(inverse)', '(inverse (2d) (2d))', '(inverse (vec3))', '(inverse nil)', '(inverse (2d scale 0))', '(inverse (mat2 1 2 2 4))', '(inverse (mat2 Infinity 0 0 1))']) assert.throws(() => evaluate(source, trace), Error);
  }
});

test('shader inverse returns the same matrix type and composes with transform', () => {
  for (const n of [2,3,4]) {
    const wgsl = compile(`(sh (m:mat${n}) (let inv (inverse m)) (return (vec4 inv.0.0)))`, bindings, forms).shaders[0].wgsl;
    assert.match(wgsl, new RegExp(`fn inverseMatrix\\d+\\(transform: mat${n}x${n}f\\) -> mat${n}x${n}f`));
    assert.match(wgsl, /if \(divisor == 0f\)/);
  }
  assert.doesNotThrow(() => compile('(sh () (return (vec4 (transform (inverse (2d scale 2)) (vec2 4)) 0 1)))', bindings, forms));
  for (const expression of ['(inverse)', '(inverse (2d) (2d))', '(inverse (vec3))', '(untransform (2d) (vec2))']) assert.throws(() => compile(`(sh () (let x ${expression}) (return (vec4 1)))`, bindings, forms), SyntaxError);
  assert.equal(Object.hasOwn(bindings, 'untransform'), false);
});
