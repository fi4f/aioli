import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, read } from '../engine/compiler.js';
import { forms } from '../engine/forms.js';
import { bindings } from '../engine/bindings.js';
import { compileShader } from '../engine/shader.js';
import { vectorBindings } from '../engine/types.js';
import { put } from '../engine/data.js';

function swizzles(letters) {
  let previous = [''];
  const result = [];
  for (let length = 1; length <= 4; length++) {
    previous = previous.flatMap(prefix => [...letters].map(letter => prefix + letter));
    result.push(...previous);
  }
  return result;
}

test('all valid one-to-four component swizzles work in both scene modes and shaders', () => {
  for (const dimension of [2, 3, 4]) {
    const components = Array.from({ length: dimension }, (_, i) => i + 1);
    const v = vectorBindings[`vec${dimension}f`](...components);
    for (const name of swizzles('xyzw'.slice(0, dimension))) {
      const expected = [...name].map(letter => components['xyzw'.indexOf(letter)]);
      for (const trace of [true, false]) {
        const result = compile(`v.${name}`, { v }, forms, { trace }).run();
        if (name.length === 1) assert.equal(result, expected[0]);
        else {
          assert.equal(result.type, `vec${name.length}f`);
          assert.deepEqual(result.values, expected);
          assert.notEqual(result, v);
          put(result, 0, 99);
          assert.deepEqual(v.values, components);
        }
      }
      const source = `(sh () (let v (vec${dimension}f ${components.join(' ')})) (let result v.${name}) (return (vec4f 1)))`;
      const result = compileShader(read(source)[0], source);
      const declaration = name.length === 1 ? 'f32' : `vec${name.length}f`;
      assert.ok(result.wgsl.includes(`var local1: ${declaration} = (local0).${name};`));
    }
  }
});

test('dot access supports expression results, chaining, annotations, and interpolation', () => {
  for (const trace of [true, false]) {
    let calls = 0;
    const evaluate = source => compile(source, {
      ...bindings, next: () => { calls++; return vectorBindings.vec4f(1, 2, 3, 4); },
    }, forms, { trace }).run();
    assert.deepEqual(evaluate('(next).wzyx').values, [4, 3, 2, 1]);
    assert.equal(calls, 1);
    assert.equal(evaluate('(vec4f 1 2 3 4).wzyx.y'), 3);
    assert.equal(evaluate('f"component {(vec2f 1 2).y}"'), 'component 2');
    assert.equal(evaluate('((vec3f 1 2 3).z : num)'), 3);
    assert.equal(evaluate('(+ (vec2f 1 2).x (vec2f 1 2).y)'), 3);
    assert.equal(evaluate('(let x 42) x'), 42);
  }
  const source = '(next).wzyx';
  const node = read(source)[0];
  assert.equal(node.kind, 'access');
  assert.equal(source.slice(node.start, node.end), source);
  assert.equal(source.slice(node.target.start, node.target.end), '(next)');
  const shaderSource = '(sh () (return (vec4f 1 2 3 4).wzyx.xyxy))';
  assert.match(compileShader(read(shaderSource)[0], shaderSource).wgsl, /\.wzyx\)\.xyxy/);
});

test('swizzles reject absent components, non-vectors, and malformed selectors with locations', () => {
  for (const trace of [true, false]) {
    for (const source of ['(vec2f 1).z', '(vec3f 1).w', '(mat2x2f 1 0 0 1).x', '(list 1 2).x', '42.x', '(vec4f 1).xxxxx', '(vec4f 1).r', '(vec4f 1).xzq']) {
      assert.throws(() => compile(source, bindings, forms, { trace }).run(),
        error => error instanceof TypeError && (!trace || Boolean(error.lisp)), source);
    }
    for (const source of ['v.', 'v..x', '.xy', '(let v.x 1)']) {
      assert.throws(() => compile(source, { v: vectorBindings.vec4f(1) }, forms, { trace }),
        error => error instanceof SyntaxError && Boolean(error.lisp), source);
    }
    for (const name of ['x', 'y', 'z', 'w', 'xy', 'xyz']) {
      assert.equal(Object.hasOwn(bindings, name), false);
    }
  }
  const source = '(let v (vec2f 1))\nv.z';
  assert.throws(() => compile(source, bindings, forms).run(), error => {
    assert.equal(source.slice(error.lisp.start, error.lisp.end), 'v.z');
    return true;
  });
  for (const value of ['(vec2f 1).z', '(vec3f 1).w', '(mat2x2f 1 0 0 1).x', '1.x']) {
    const source = `(sh () (return (vec4f ${value})))`;
    assert.throws(() => compileShader(read(source)[0], source), error => error instanceof SyntaxError && Boolean(error.lisp));
  }
});

test('dot access does not change numeric literals, strings, comments, or exponent parsing', () => {
  for (const [source, expected] of [['.5', 0.5], ['-.5', -0.5], ['1.', 1], ['1.25', 1.25], ['1.2e-3', 0.0012], ['-0', -0], ['"v.xy"', 'v.xy']]) {
    assert.ok(Object.is(compile(source, {}, forms).run(), expected));
  }
  assert.equal(compile('; v.invalid\n42', {}, forms).run(), 42);
  assert.throws(() => compile('1e999', {}, forms), SyntaxError);
});
