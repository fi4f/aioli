import { dataKind, vector } from './data.js';
import { vectorInfo, scalarMatches } from './numeric-types.js';

const unary = { sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, sqrt: Math.sqrt };
const operations = { ...unary, min: Math.min, max: Math.max, clamp: (x, low, high) => {
  if (low > high) throw new RangeError('clamp minimum must not exceed maximum');
  return Math.min(Math.max(x, low), high);
} };
export const mathBindings = Object.fromEntries(Object.entries(operations).map(([name, operation]) => [name, (...values) => {
  const arity = name === 'clamp' ? 3 : name === 'min' || name === 'max' ? 2 : 1;
  if (values.length !== arity) throw new TypeError(`${name} expects exactly ${arity} numeric operands`);
  const shapes = values.map(value => typeof value === 'number' ? null : vectorInfo(dataKind(value)));
  if (values.some((value, i) => typeof value !== 'number' && !shapes[i])) throw new TypeError(`${name} expects numeric scalars or vectors`);
  const shape = shapes.find(Boolean);
  if (!shape) return operation(...values);
  if (shapes.some(info => info && (info.size !== shape.size || info.scalar !== shape.scalar))) throw new TypeError(`${name} vector dimensions and scalar families must match`);
  if (Object.hasOwn(unary, name) && shape.scalar !== 'f32') throw new TypeError(`${name} requires float vectors`);
  values.forEach((value, i) => {
    if (!shapes[i] && shape.scalar === 'f32') values[i] = Math.fround(value);
    if (!shapes[i] && !scalarMatches(values[i], shape.scalar)) throw new TypeError(`${name} scalar must match the vector family`);
  });
  const type = dataKind(values[shapes.findIndex(Boolean)]);
  return vector(shape.size, Array.from({ length: shape.size }, (_, i) => operation(...values.map((value, j) => shapes[j] ? value.values[i] : value))), type);
}]));
