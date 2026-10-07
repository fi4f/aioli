import { dataKind, matrix, vector as makeVector } from './data.js';
import { collectionInfo } from './structures.js';

export const transformKeys = ['translate', 'scale', 'rotate', 'skew'];
export function parseTransformPairs(entries, keyOf, fail) {
  if (entries.length % 2) fail('Transform constructors expect named key/value pairs');
  const result = new Map();
  for (let i = 0; i < entries.length; i += 2) {
    const key = keyOf(entries[i]);
    if (!transformKeys.includes(key)) fail(`Unknown transform parameter: ${key}`, entries[i]);
    if (result.has(key)) fail(`Duplicate transform parameter: ${key}`, entries[i]);
    result.set(key, entries[i + 1]);
  }
  return result;
}
function finite(value) {
  if (typeof value !== 'number' || !Number.isFinite(Math.fround(value))) throw new TypeError('Transform components must be finite f32 numbers');
  return Math.fround(value);
}
function vector(value, size, fallback, splat = false) {
  if (value === undefined) return Array(size).fill(fallback);
  if (splat && typeof value === 'number') return Array(size).fill(finite(value));
  if (dataKind(value) !== `vec${size}f`) throw new TypeError(`Expected vec${size}f${splat ? ' or scalar scale' : ''}`);
  return Array.from(value.values, finite);
}
function multiply(a, b, size) {
  return Array.from({ length: size * size }, (_, i) => {
    const row = i % size, column = Math.floor(i / size);
    let sum = 0;
    for (let k = 0; k < size; k++) sum = Math.fround(sum + Math.fround(a[k * size + row] * b[column * size + k]));
    return sum;
  });
}
function finish(size, matrices) {
  const values = matrices.reduce((a, b) => multiply(a, b, size));
  if (values.some(value => !Number.isFinite(value))) throw new RangeError('Transform exceeds finite f32 matrix range');
  return matrix(size, values);
}
const pairs = entries => parseTransformPairs(entries, key => key, message => { throw new TypeError(message); });
export function transform2d(...entries) {
  const options = pairs(entries);
  const [px, py] = vector(options.get('translate'), 2, 0);
  const [sx, sy] = vector(options.get('scale'), 2, 1, true);
  const angle = options.has('rotate') ? finite(options.get('rotate')) : 0;
  const [kx, ky] = vector(options.get('skew'), 2, 0).map(value => Math.fround(Math.tan(value)));
  const c = Math.fround(Math.cos(angle)), s = Math.fround(Math.sin(angle));
  return finish(3, [
    [1, 0, 0, 0, 1, 0, px, py, 1],
    [c, s, 0, -s, c, 0, 0, 0, 1],
    [1, ky, 0, kx, 1, 0, 0, 0, 1],
    [sx, 0, 0, 0, sy, 0, 0, 0, 1],
  ]);
}
export function transform3d(...entries) {
  const options = pairs(entries);
  const [px, py, pz] = vector(options.get('translate'), 3, 0);
  const [sx, sy, sz] = vector(options.get('scale'), 3, 1, true);
  const rotate = vector(options.get('rotate'), 3, 0);
  let skew = Array(6).fill(0);
  if (options.has('skew')) {
    const value = options.get('skew'), info = collectionInfo(value);
    if (dataKind(value) !== 'array' || info?.element.type !== 'f32' || info.length !== 6) throw new TypeError('3d skew expects an array of six f32 angles: xy, xz, yx, yz, zx, zy');
    skew = Array.from({ length: 6 }, (_, i) => finite(info.storage[(info.offset || 0) + i * info.stride]));
  }
  const [xy, xz, yx, yz, zx, zy] = skew.map(value => Math.fround(Math.tan(value)));
  const [cx, cy, cz] = rotate.map(value => Math.fround(Math.cos(value)));
  const [rx, ry, rz] = rotate.map(value => Math.fround(Math.sin(value)));
  return finish(4, [
    [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, px, py, pz, 1],
    [cz, rz, 0, 0, -rz, cz, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    [cy, 0, -ry, 0, 0, 1, 0, 0, ry, 0, cy, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, cx, rx, 0, 0, -rx, cx, 0, 0, 0, 0, 1],
    [1, yx, zx, 0, xy, 1, zy, 0, xz, yz, 1, 0, 0, 0, 0, 1],
    [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, 0, 0, 0, 1],
  ]);
}
export const isTransformConstructor = value => value === transform2d || value === transform3d;
export function transformPoint(...operands) {
  const name = 'transform';
  if (operands.length !== 2) throw new TypeError(`${name} expects exactly two operands: a matrix and a float vector`);
  const [transform, value] = operands;
  const kind = dataKind(transform);
  const size = kind === 'mat3x3f' ? 2 : kind === 'mat4x4f' ? 3 : 0;
  if (!size || dataKind(value) !== `vec${size}f`) throw new TypeError(`${name} expects mat3x3f and vec2f, or mat4x4f and vec3f`);
  const n = size + 1;
  const component = row => {
    let sum = 0;
    for (let column = 0; column < size; column++) sum += transform.values[column * n + row] * value.values[column];
    return sum + transform.values[size * n + row];
  };
  const divisor = Math.fround(component(size));
  return makeVector(size, Array.from({ length: size }, (_, row) => Math.fround(component(row)) / divisor));
}
export function inverse(...operands) {
  if (operands.length !== 1) throw new TypeError('inverse expects exactly one square float matrix');
  const [transform] = operands;
  const n = /^mat([234])x\1f$/.exec(dataKind(transform) || '')?.[1] * 1;
  if (!n) throw new TypeError('inverse expects a mat2x2f, mat3x3f or mat4x4f');
  if (transform.values.some(value => !Number.isFinite(value))) throw new TypeError('inverse requires finite matrix components');
  const rows = Array.from({ length: n }, (_, row) => [
    ...Array.from({ length: n }, (_, column) => transform.values[column * n + row]),
    ...Array.from({ length: n }, (_, column) => +(row === column)),
  ]);
  for (let column = 0; column < n; column++) {
    let pivot = column;
    for (let row = column + 1; row < n; row++) if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    if (rows[pivot][column] === 0) throw new RangeError('inverse requires an invertible matrix');
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    for (let k = 0; k < 2 * n; k++) rows[column][k] /= divisor;
    for (let row = 0; row < n; row++) if (row !== column) {
      const factor = rows[row][column];
      for (let k = 0; k < 2 * n; k++) rows[row][k] -= factor * rows[column][k];
    }
  }
  const values = Array.from({ length: n * n }, (_, i) => rows[i % n][n + Math.floor(i / n)]);
  if (values.some(value => !Number.isFinite(Math.fround(value)))) throw new RangeError('inverse exceeds finite f32 matrix range');
  return matrix(n, values);
}
export function inverseWGSL(helper, n) {
  const identity = Array.from({ length: n * n }, (_, i) => i % (n + 1) === 0 ? '1f' : '0f').join(', ');
  return `fn ${helper}(transform: mat${n}x${n}f) -> mat${n}x${n}f {
var a = transform;
var result = mat${n}x${n}f(${identity});
for (var column = 0u; column < ${n}u; column++) {
  var pivot = column;
  for (var row = column + 1u; row < ${n}u; row++) {
    if (abs(a[column][row]) > abs(a[column][pivot])) { pivot = row; }
  }
  for (var k = 0u; k < ${n}u; k++) {
    let swap = a[k][column]; a[k][column] = a[k][pivot]; a[k][pivot] = swap;
    let swapResult = result[k][column]; result[k][column] = result[k][pivot]; result[k][pivot] = swapResult;
  }
  let divisor = a[column][column];
  if (divisor == 0f) { return mat${n}x${n}f(); }
  for (var k = 0u; k < ${n}u; k++) { a[k][column] /= divisor; result[k][column] /= divisor; }
  for (var row = 0u; row < ${n}u; row++) {
    if (row != column) {
      let factor = a[column][row];
      for (var k = 0u; k < ${n}u; k++) {
        a[k][row] -= factor * a[k][column];
        result[k][row] -= factor * result[k][column];
      }
    }
  }
}
return result;
}`;
}
export const transformBindings = { '2d': transform2d, '3d': transform3d, transform: transformPoint, inverse };

export const transformWGSL = {
  '2d': `fn transform2d(translate: vec2f, scale: vec2f, rotate: f32, skew: vec2f) -> mat3x3f {
let c = cos(rotate); let s = sin(rotate);
let t = mat3x3f(1f, 0f, 0f, 0f, 1f, 0f, translate.x, translate.y, 1f);
let r = mat3x3f(c, s, 0f, -s, c, 0f, 0f, 0f, 1f);
let h = mat3x3f(1f, tan(skew.y), 0f, tan(skew.x), 1f, 0f, 0f, 0f, 1f);
let d = mat3x3f(scale.x, 0f, 0f, 0f, scale.y, 0f, 0f, 0f, 1f);
return t * r * h * d;
}`,
  '3d': `fn transform3d(translate: vec3f, scale: vec3f, rotate: vec3f, skew: array<f32, 6>) -> mat4x4f {
let c = cos(rotate); let s = sin(rotate);
let t = mat4x4f(1f, 0f, 0f, 0f, 0f, 1f, 0f, 0f, 0f, 0f, 1f, 0f, translate.x, translate.y, translate.z, 1f);
let rz = mat4x4f(c.z, s.z, 0f, 0f, -s.z, c.z, 0f, 0f, 0f, 0f, 1f, 0f, 0f, 0f, 0f, 1f);
let ry = mat4x4f(c.y, 0f, -s.y, 0f, 0f, 1f, 0f, 0f, s.y, 0f, c.y, 0f, 0f, 0f, 0f, 1f);
let rx = mat4x4f(1f, 0f, 0f, 0f, 0f, c.x, s.x, 0f, 0f, -s.x, c.x, 0f, 0f, 0f, 0f, 1f);
let h = mat4x4f(1f, tan(skew[2]), tan(skew[4]), 0f, tan(skew[0]), 1f, tan(skew[5]), 0f, tan(skew[1]), tan(skew[3]), 1f, 0f, 0f, 0f, 0f, 1f);
let d = mat4x4f(scale.x, 0f, 0f, 0f, 0f, scale.y, 0f, 0f, 0f, 0f, scale.z, 0f, 0f, 0f, 0f, 1f);
return t * rz * ry * rx * h * d;
}`,
};
