import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, read } from '../engine/compiler/compiler.js';
import { forms } from '../engine/compiler/forms.js';
import { bindings } from '../engine/language/bindings.js';
import { compileShader } from '../engine/compiler/shader.js';
import { vectorBindings, swizzle, setAccess } from '../engine/language/types.js';
import { vectorTypes, vectorInfo } from '../engine/language/numeric-types.js';
import { put } from '../engine/language/data.js';

function swizzles(letters) {
  let previous = [''];
  const result = [];
  for (let length = 1; length <= 4; length++) {
    previous = previous.flatMap(prefix => [...letters].map(letter => prefix + letter));
    result.push(...previous);
  }
  return result;
}

test('every generated read and writable permutation preserves its numeric family', () => {
  for (const type of vectorTypes) {
    const { size, suffix } = vectorInfo(type);
    const components = Array.from({ length: size }, (_, i) => i + 1);
    for (const name of swizzles('xyzw'.slice(0, size))) {
      const target = vectorBindings[type](...components);
      const indices = [...name].map(letter => 'xyzw'.indexOf(letter));
      const expected = indices.map(index => components[index]);
      const result = swizzle(target, name);
      if (name.length === 1) assert.equal(result, expected[0]);
      else {
        assert.equal(result.type, `vec${name.length}${suffix}`);
        assert.deepEqual(result.values, expected);
        assert.notEqual(result.values, target.values);
        assert.equal(Object.isSealed(result.values), true);
        assert.equal(Object.getOwnPropertyDescriptor(result.values, 'length').writable, false);
      }
      const replacement = name.length === 1 ? 9 : vectorBindings[`vec${name.length}${suffix}`](...indices.map((_, i) => i + 5));
      if (new Set(name).size !== name.length) {
        assert.throws(() => setAccess(target, name, replacement), /distinct components/);
        assert.deepEqual(target.values, components);
      } else {
        assert.equal(setAccess(target, name, replacement), replacement);
        const written = [...components];
        indices.forEach((index, i) => { written[index] = name.length === 1 ? replacement : replacement.values[i]; });
        assert.deepEqual(target.values, written);
      }
    }
    const target = vectorBindings[type](...components);
    assert.equal(setAccess(target, 'xyzw'.slice(0, size).split('').reverse().join(''), target), target);
    assert.deepEqual(target.values, [...components].reverse());
  }
});

test('generated accessors reject invalid selectors and corrupted targets before writing', () => {
  for (const type of vectorTypes) {
    const target = vectorBindings[type](1);
    for (const name of ['xxxxx', '', 'r', 'xzq', '__proto__', 'constructor', 'toString']) {
      assert.throws(() => swizzle(target, name), /Invalid vector swizzle/);
      assert.throws(() => setAccess(target, name, 2), /distinct components/);
    }
    if (target.values.length < 4) {
      assert.throws(() => swizzle(target, 'w'), /expected a vector/);
      assert.throws(() => setAccess(target, 'w', 2), /expected a vector/);
    }
    target.values[0] = 'corrupted';
    assert.throws(() => swizzle(target, 'y'), /Swizzle target/);
    assert.throws(() => setAccess(target, 'y', 2), /Swizzle target/);
    assert.equal(target.values[1], 1);
  }
});

test('generated writes validate all checked-view components before mutation', () => {
  for (const trace of [true, false]) {
    const source = '(struct Item v:vec2f) (let items (array (Item 1) (Item v (vec2f 1 2)))) items.0.v';
    const target = compile(source, bindings, forms, { trace }).run();
    assert.throws(() => setAccess(target, 'xy', vectorBindings.vec2f(3, Infinity)), /finite f32/);
    assert.deepEqual(Array.from(target.values), [1, 2]);
    setAccess(target, 'yx', target);
    assert.deepEqual(Array.from(target.values), [2, 1]);
    setAccess(target, 'x', 0.1);
    assert.equal(target.values[0], Math.fround(0.1));
  }
});

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
