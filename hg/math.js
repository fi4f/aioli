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
};
const __operations__ = {
  ...__unary__,
  min: Math.min,
  max: Math.max,
  clamp: (x, low, high) => {
    if (low > high) throw new RangeError('clamp minimum must not exceed maximum');
    return Math.min(Math.max(x, low), high);
  },
};
function __apply__(name, operation, arity, values) {
  if (values.length !== arity)
    throw new TypeError(`${name} expects exactly ${arity} numeric operands`);
  const shapes = values.map((value) =>
    typeof value === 'number' ? null : NumericTypes.vectorInfo(Data.dataKind(value)),
  );
  if (values.some((value, i) => typeof value !== 'number' && !shapes[i]))
    throw new TypeError(`${name} expects numeric scalars or vectors`);
  const shape = shapes.find(Boolean);
  values.forEach((value, i) => Types.assertType(value, shapes[i] ? Data.dataKind(value) : 'num'));
  if (!shape) return NumericTypes.assertFinite(operation(...values), `${name} result`);
  if (shapes.some((info) => info && (info.size !== shape.size || info.scalar !== shape.scalar)))
    throw new TypeError(`${name} vector dimensions and scalar families must match`);
  if (Object.hasOwn(__unary__, name) && shape.scalar !== 'f32')
    throw new TypeError(`${name} requires float vectors`);
  values.forEach((value, i) => {
    if (!shapes[i] && shape.scalar === 'f32') values[i] = Math.fround(value);
    if (!shapes[i] && !NumericTypes.scalarMatches(values[i], shape.scalar))
      throw new TypeError(`${name} scalar must match the vector family`);
  });
  const type = Data.dataKind(values[shapes.findIndex(Boolean)]);
  return Data.vector(
    shape.size,
    Array.from({ length: shape.size }, (_, i) =>
      operation(...values.map((value, j) => (shapes[j] ? Data.component(value, i) : value))),
    ),
    type,
  );
}

const __mathBindings__ = {
  sin: (...values) => __apply__('sin', __operations__.sin, 1, values),
  cos: (...values) => __apply__('cos', __operations__.cos, 1, values),
  tan: (...values) => __apply__('tan', __operations__.tan, 1, values),
  asin: (...values) => __apply__('asin', __operations__.asin, 1, values),
  acos: (...values) => __apply__('acos', __operations__.acos, 1, values),
  atan: (...values) => __apply__('atan', __operations__.atan, 1, values),
  sqrt: (...values) => __apply__('sqrt', __operations__.sqrt, 1, values),
  min: (...values) => __apply__('min', __operations__.min, 2, values),
  max: (...values) => __apply__('max', __operations__.max, 2, values),
  clamp: (...values) => __apply__('clamp', __operations__.clamp, 3, values),
};

export const Maths = { bindings: __mathBindings__ };
