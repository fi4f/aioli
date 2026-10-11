import { Data } from '../data.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Compiler } from '../compiler.js';
import { Forms } from '../forms.js';
import { Bindings } from '../bindings.js';
import { NumericTypes } from '../numeric-types.js';
const evaluate = (source, trace = true, extra = {}) =>
  Compiler.run(Compiler.compile(source, { ...Bindings, ...extra }, Forms, { trace }));

test('vector constructors support zero, scalar splats, recursive lists, padding, and trimming', () => {
  for (const trace of [true, false])
    for (const type of NumericTypes.vectorTypes) {
      const { size, suffix } = NumericTypes.vectorInfo(type);
      const components = Array.from({ length: size }, (_, i) => i + 1);
      assert.deepEqual(Data.values(evaluate(`(${type})`, trace)), Array(size).fill(0));
      assert.deepEqual(Data.values(evaluate(`(${type} 7)`, trace)), Array(size).fill(7));
      assert.deepEqual(
        Data.values(evaluate(`(${type} (list (list ${components.join(' ')})))`, trace)),
        components,
      );
      const mixed =
        size === 2
          ? `(${type} (vec2${suffix} 1 2))`
          : size === 3
            ? `(${type} (vec2${suffix} 1 2) 3)`
            : `(${type} 1 (list 2 3) 4)`;
      assert.deepEqual(Data.values(evaluate(mixed, trace)), components);
      const converted = evaluate(`(${type} (vec${size}f ${components.join(' ')}))`, trace);
      assert.equal(converted.__type__, type);
      assert.deepEqual(Data.values(converted), components);
      const sourceSize = size === 2 ? 3 : 2;
      assert.deepEqual(
        Data.values(evaluate(`(${type} (vec${sourceSize}f 1))`, trace)),
        Array.from({ length: size }, (_, index) => (index < sourceSize ? 1 : 0)),
      );
      assert.deepEqual(
        Data.values(
          evaluate(
            `(${type} ${Array(size + 1)
              .fill(1)
              .join(' ')})`,
            trace,
          ),
        ),
        Array(size).fill(1),
      );
      assert.throws(() => evaluate(`(${type} "1")`, trace), Error);
    }
  let calls = 0;
  const result = evaluate('(vec4 (next))', false, {
    next: () => {
      calls++;
      return 3;
    },
  });
  assert.deepEqual(Data.values(result), [3, 3, 3, 3]);
  assert.equal(calls, 1);
});

test('matrix constructors support zero, column-wise, and column-major scalar-wise overloads', () => {
  for (const trace of [true, false])
    for (const size of [2, 3, 4]) {
      const type = `mat${size}x${size}f`,
        alias = `mat${size}`;
      const components = Array.from({ length: size * size }, (_, i) => i + 1);
      const columns = Array.from(
        { length: size },
        (_, column) =>
          `(vec${size} ${components.slice(column * size, (column + 1) * size).join(' ')})`,
      ).join(' ');
      assert.deepEqual(Data.values(evaluate(`(${type})`, trace)), Array(size * size).fill(0));
      assert.deepEqual(Data.values(evaluate(`(${alias})`, trace)), Array(size * size).fill(0));
      assert.deepEqual(Data.values(evaluate(`(${type} ${columns})`, trace)), components);
      assert.deepEqual(
        Data.values(evaluate(`(${alias} ${components.join(' ')})`, trace)),
        components,
      );
      assert.equal(evaluate(`(${type} ${columns}).1.0`, trace), size + 1);
      for (const source of [
        `(${type} 0)`,
        `(${alias} 1)`,
        `(${type} (vec${size}u 1))`,
        `(${type} ${Array(size).fill(1).join(' ')})`,
        `(${type} ${Array(size).fill(`(vec${size}i 1)`).join(' ')})`,
      ])
        assert.throws(() => evaluate(source, trace), TypeError);
    }
  const events = [];
  const result = evaluate('(mat2 (column 1) (column 2))', true, {
    column: (value) => {
      events.push(value);
      return Bindings.vec2(value, value + 1);
    },
  });
  assert.deepEqual(events, [1, 2]);
  assert.deepEqual(Data.values(result), [1, 2, 2, 3]);
});

test('shader constructors emit native WGSL overloads and reject diagonal shorthand', () => {
  for (const size of [2, 3, 4]) {
    const type = `mat${size}x${size}f`,
      columns = Array(size).fill(`(vec${size}f 1)`).join(' '),
      scalars = Array(size * size)
        .fill(1)
        .join(' ');
    const source = `(sh () (let zero (${type})) (let columns (${type} ${columns}))
      (let scalars (mat${size} ${scalars})) (return (vec4 (+ zero.0.0 columns.0.0 scalars.0.0))))`;
    const wgsl = Compiler.compile(source, Bindings, Forms).shaders[0].wgsl;
    assert.match(wgsl, new RegExp(`${type}\\(\\)`));
    assert.doesNotMatch(wgsl, /diagonal/);
    assert.throws(
      () => Compiler.compile(`(sh () (let m (${type} 1)) (return (vec4 1)))`, Bindings, Forms),
      SyntaxError,
    );
  }
  for (const type of NumericTypes.vectorTypes) {
    const size = NumericTypes.vectorInfo(type).size;
    const source = `(sh () (let zero (${type})) (let resized (${type} (vec${size === 2 ? 3 : 2}f 2)))
      (let components (${type} (list (list ${Array(size).fill(1).join(' ')})))) (return (vec4f (f32 zero.x) (f32 resized.x) (f32 components.x) 1)))`;
    assert.match(
      Compiler.compile(source, Bindings, Forms).shaders[0].wgsl,
      new RegExp(`${type}\\(\\)`),
    );
  }
});
