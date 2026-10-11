import { Data } from '../data.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Compiler } from "../compiler.js";
import { Bindings } from "../bindings.js";
import { Forms } from "../forms.js";
const evaluate = (source, trace, extra = {}) => Compiler.run(Compiler.compile(source, { ...Bindings, ...extra }, Forms, { trace }));
const close = (actual, expected) => actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 0.0001, `${actual} != ${expected}`));

test('inverse supports all square matrices, row pivoting, fresh storage and multiplication identities', () => {
  for (const trace of [true, false]) for (const n of [2,3,4]) {
    const values = Array.from({ length: n * n }, (_, i) => i % (n + 1) === 0 ? 10 + i : (i % 3) - 1);
    const matrix = Bindings[`mat${n}`](...values), original = [...Data.values(matrix)];
    const result = evaluate('(inverse m)', trace, { m: matrix });
    assert.equal(result.type, matrix.type); assert.notEqual(result, matrix);
    const identity = Array.from({ length: n*n }, (_, i) => +(i % (n+1) === 0));
    close(Data.values(Bindings['*'](matrix,result)), identity);
    close(Data.values(Bindings['*'](result,matrix)), identity);
    Data.values(result)[0] = 99; assert.deepEqual(Data.values(matrix), original);
    close(Data.values(evaluate('(let invert inverse) (invert (mat2 0 1 1 0))', trace)), [0,1,1,0]);
  }
});

test('inverse undoes affine and projective point transforms and evaluates its operand once', () => {
  for (const trace of [true, false]) {
    for (const [matrix, point] of [
      ['(2d translate (vec2 10 20) rotate 0.4 scale (vec2 2 3) skew (vec2 0.1 0.2))','(vec2 2 3)'],
      ['(3d translate (vec3 10 20 30) rotate (vec3 0.1 0.2 0.3) scale 2)','(vec3 2 3 4)'],
      ['(mat3 1 0 0.25 0 1 0 10 20 2)','(vec2 2 3)'],
    ]) {
      const expected = Data.values(evaluate(point, trace));
      close(Data.values(evaluate(`(let m ${matrix}) (let p ${point}) (transform (inverse m) (transform m p))`, trace)), expected);
    }
    let calls = 0;
    evaluate('(inverse (next))', trace, { next: () => { calls++; return Bindings['2d'](); } });
    assert.equal(calls, 1);
    for (const source of ['(inverse)', '(inverse (2d) (2d))', '(inverse (vec3))', '(inverse nil)', '(inverse (2d scale 0))', '(inverse (mat2 1 2 2 4))', '(inverse (mat2 Infinity 0 0 1))']) assert.throws(() => evaluate(source, trace), Error);
  }
});

test('shader inverse returns the same matrix type and composes with transform', () => {
  for (const n of [2,3,4]) {
    const wgsl = Compiler.compile(`(sh (m:mat${n}) (let inv (inverse m)) (return (vec4 inv.0.0)))`, Bindings, Forms).shaders[0].wgsl;
    assert.match(wgsl, new RegExp(`fn inverseMatrix\\d+\\(transform: mat${n}x${n}f\\) -> mat${n}x${n}f`));
    assert.match(wgsl, /if \(divisor == 0f\)/);
  }
  assert.doesNotThrow(() => Compiler.compile('(sh () (return (vec4 (transform (inverse (2d scale 2)) (vec2 4)) 0 1)))', Bindings, Forms));
  for (const expression of ['(inverse)', '(inverse (2d) (2d))', '(inverse (vec3))', '(untransform (2d) (vec2))']) assert.throws(() => Compiler.compile(`(sh () (let x ${expression}) (return (vec4 1)))`, Bindings, Forms), SyntaxError);
  assert.equal(Object.hasOwn(Bindings, 'untransform'), false);
});
