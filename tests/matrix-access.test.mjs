import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../engine/compiler.js';
import { bindings } from '../engine/bindings.js';
import { forms } from '../engine/forms.js';

test('vector indices and column-first matrix chains read every component in both modes', () => {
  for (const trace of [true, false]) {
    const evaluate = source => compile(source, bindings, forms, { trace }).run();
    for (const size of [2, 3, 4]) {
      for (let column = 0; column < size; column++) {
        assert.equal(evaluate(`(vec${size}f ${Array.from({ length: size }, (_, i) => i + 1).join(' ')}).${column}`), column + 1);
        for (let row = 0; row < size; row++) {
          const source = `(mat${size}x${size}f ${Array.from({ length: size * size }, (_, i) => i + 1).join(' ')}).${column}.${row}`;
          assert.equal(evaluate(source), column * size + row + 1);
        }
      }
    }
    assert.deepEqual(evaluate('(mat2x2f 1 2 3 4).1').values, [3, 4]);
    assert.equal(evaluate('(mat2x2f 1 2 3 4).1.y'), 4);
  }
});

test('numeric dot writes, column replacement, live aliases, and copies preserve matrix storage', () => {
  for (const trace of [true, false]) {
    const evaluate = source => compile(source, bindings, forms, { trace }).run();
    assert.deepEqual(evaluate('(let v (vec3f 1 2 3)) (set v.1 5) v').values, [1, 5, 3]);
    assert.deepEqual(evaluate('(let m (mat2x2f)) (set m.1.0 5) (set m.0 (vec2f 1 2)) m').values, [1, 2, 5, 0]);
    assert.equal(evaluate('(let m (mat2x2f)) (let column m.1) (set column.x 7) m.1.0'), 7);
    assert.equal(evaluate('(let m (mat2x2f)) (let column (copy m.1)) (set column.0 7) m.1.0'), 0);
    assert.deepEqual(evaluate('(let m (mat2x2f 1 2 3 4)) (set m.0 m.1) m').values, [3, 4, 3, 4]);
    assert.equal(evaluate('(let m (mat2x2f)) (set m.0.xy (vec2f Infinity 0)) m.0.0'), Infinity);
    assert.equal(evaluate(`(struct Example transform:mat3x3f)
      (let data (array (Example 1) (Example transform (mat3x3f)))) (set data.0.transform.2.1 0.5) data.0.transform.2.y`), 0.5);
    assert.throws(() => evaluate(`(let data (array (mat2x2f 1) (mat2x2f)))
      (set data.0.0 (vec2f 1 Infinity))`), TypeError);
  }
});

test('invalid numeric selectors and column replacements fail without numeric swizzling', () => {
  for (const trace of [true, false]) {
    for (const source of ['(vec2f 1).2', '(vec3f 1).-1', '(vec4f 1).12', '(mat2x2f 1 0 0 1).2.0',
      '(vec2f 1)."0"', '(mat2x2f 1 0 0 1)."0"', '(mat2x2f 1 0 0 1).xy',
      '(let m (mat2x2f 1 0 0 1)) (set m.0 1)', '(let m (mat2x2f 1 0 0 1)) (set m.0 (vec3f 1))']) {
      assert.throws(() => compile(source, bindings, forms, { trace }).run(), error => error instanceof Error && (!trace || Boolean(error.lisp)), source);
    }
  }
});

test('shader numeric dot reads and writes emit column/vector indexing with static bounds checks', () => {
  const program = compile(`(sh () (let m (mat2x2f))
    (set m.0 (vec2f 0.2 0.4)) (set m.1.0 0.6)
    (let v (vec4f 0)) (set v.0 m.0.0) (set v.1 m.0.y)
    (return (vec4f v.0 v.1 m.1.0 1)))`, {}, forms);
  const code = program.shaders[0].wgsl;
  assert.match(code, /local0\[0u\] = vec2f/);
  assert.match(code, /local0\[1u\]\[0u\] = 0.6f/);
  for (const source of ['(sh () (return (vec4f (vec2f 1).2)))', '(sh () (return (vec4f (mat2x2f 1 0 0 1).2.0)))',
    '(sh () (let m (mat2x2f 1 0 0 1)) (set m.0 1) (return (vec4f 1)))']) {
    assert.throws(() => compile(source, {}, forms), SyntaxError);
  }
});
