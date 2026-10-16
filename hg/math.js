import { Data } from './data.js';
import { NumericTypes } from './numeric-types.js';
import { Types } from './types.js';

const __unary__ = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sqrt: Math.sqrt,
  log2: Math.log2,
};
const __operations__ = {
  ...__unary__,
  abs: Math.abs,
  min: Math.min,
  max: Math.max,
  clamp: (x, low, high) => {
    if (low > high) throw new RangeError('clamp minimum must not exceed maximum');
    return Math.min(Math.max(x, low), high);
  },
};
function __apply__(name, operation, arity, values) {
  const variadic = name === 'min' || name === 'max';
  if (variadic && values.length < 1)
    throw new TypeError(`${name} expects one or more numeric operands`);
  if (!variadic && values.length !== arity)
    throw new TypeError(`${name} expects exactly ${arity} numeric operands`);
  let shape = null, type = null, mismatch = false;
  for (const value of values) {
    if (typeof value === 'number') continue;
    const kind = Data.dataKind(value), info = NumericTypes.vectorInfo(kind);
    if (!info) throw new TypeError(`${name} expects numeric scalars or vectors`);
    if (shape && (info.size !== shape.size || info.scalar !== shape.scalar)) mismatch = true;
    if (!shape) { shape = info; type = kind; }
  }
  for (const value of values) Types.assertType(value, typeof value === 'number' ? 'num' : Data.dataKind(value));
  if (!shape) return NumericTypes.assertFinite(operation(...values), `${name} result`);
  if (mismatch)
    throw new TypeError(`${name} vector dimensions and scalar families must match`);
  if (Object.hasOwn(__unary__, name) && shape.scalar !== 'f32')
    throw new TypeError(`${name} requires float vectors`);
  for (let i = 0; i < values.length; i++) {
    if (typeof values[i] !== 'number') continue;
    if (shape.scalar === 'f32') values[i] = Math.fround(values[i]);
    if (!NumericTypes.scalarMatches(values[i], shape.scalar))
      throw new TypeError(`${name} scalar must match the vector family`);
  }
  return Data.vector(
    shape.size,
    Array.from({ length: shape.size }, (_, i) => {
      const operands = values.map(value => typeof value === 'number' ? value : Data.component(value, i));
      // WGSL abs preserves the smallest i32, whose positive magnitude is out of range.
      if (name === 'abs' && shape.scalar === 'i32' && operands[0] === -2147483648)
        return operands[0];
      return operation(...operands);
    }),
    type,
  );
}

const __mathBindings__ = {
  abs: (...values) => __apply__('abs', __operations__.abs, 1, values),
  sin: (...values) => __apply__('sin', __operations__.sin, 1, values),
  cos: (...values) => __apply__('cos', __operations__.cos, 1, values),
  tan: (...values) => __apply__('tan', __operations__.tan, 1, values),
  asin: (...values) => __apply__('asin', __operations__.asin, 1, values),
  acos: (...values) => __apply__('acos', __operations__.acos, 1, values),
  atan: (...values) => __apply__('atan', __operations__.atan, 1, values),
  sqrt: (...values) => __apply__('sqrt', __operations__.sqrt, 1, values),
  log2: (...values) => __apply__('log2', __operations__.log2, 1, values),
  min: (...values) => __apply__('min', __operations__.min, 2, values),
  max: (...values) => __apply__('max', __operations__.max, 2, values),
  clamp: (...values) => __apply__('clamp', __operations__.clamp, 3, values),
};

export const Maths = { bindings: __mathBindings__ };
