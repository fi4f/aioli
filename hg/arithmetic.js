import { Types } from './types.js';
import { Data } from './data.js';
import { Numeric } from './numeric.js';
import { NumericTypes } from './numeric-types.js';
import { VectorArithmetic } from './arithmetic.generated.js';

function __numbers__(name, values, minimum = 0, maximum = Infinity) {
  if (values.length < minimum || values.length > maximum) {
    throw new TypeError(
      `${name}: expected ${minimum === maximum ? minimum : `at least ${minimum}`} operands`,
    );
  }
  for (let i = 0; i < values.length; i++) {
    Types.assertType(values[i], 'num', `${name}: operand ${i + 1}`);
  }
}

const __scalarArithmetic__ = {
  '+': (...values) => {
    __numbers__('+', values);
    let result = 0;
    for (const value of values) result += value;
    return NumericTypes.assertFinite(result, '+ result');
  },
  '-': (...values) => {
    __numbers__('-', values, 1);
    if (values.length === 1) return -values[0];
    let result = values[0];
    for (let i = 1; i < values.length; i++) result -= values[i];
    return NumericTypes.assertFinite(result, '- result');
  },
  '*': (...values) => {
    __numbers__('*', values);
    let result = 1;
    for (const value of values) result *= value;
    return NumericTypes.assertFinite(result, '* result');
  },
  '/': (...values) => {
    __numbers__('/', values, 1);
    if (values.length === 1) return NumericTypes.assertFinite(1 / values[0], '/ result');
    let result = values[0];
    for (let i = 1; i < values.length; i++) result /= values[i];
    return NumericTypes.assertFinite(result, '/ result');
  },
  '%': (...values) => {
    __numbers__('%', values, 2, 2);
    return NumericTypes.assertFinite(values[0] % values[1], '% result');
  },
};

const __typeOf__ = (value) => Data.dataKind(value) || 'num';
// Arithmetic rejects non-finite results; explicit constructors clamp finite inputs.
const __construct__ = (type, values) =>
  Numeric.isMatrix(type)
    ? Data.numericFromComponents(type, values.map(Math.fround))
    : Data.vector(NumericTypes.vectorInfo(type).size, values, type);
function __binary__(operator, left, right) {
  let a = __typeOf__(left),
    b = __typeOf__(right);
  if (a === 'num' && NumericTypes.vectorInfo(b)?.suffix) {
    a = NumericTypes.vectorInfo(b).scalar;
    if (a === 'f32') left = Math.fround(left);
    Types.assertType(left, a);
  }
  if (b === 'num' && NumericTypes.vectorInfo(a)?.suffix) {
    b = NumericTypes.vectorInfo(a).scalar;
    if (b === 'f32') right = Math.fround(right);
    Types.assertType(right, b);
  }
  const type = Numeric.resultType(operator, a, b);
  if (type === 'num') return __scalarArithmetic__[operator](left, right);
  if (!Numeric.isMatrix(a) && !Numeric.isMatrix(b)) {
    const mode = Numeric.isScalar(a) ? 'sv' : Numeric.isScalar(b) ? 'vs' : 'vv';
    return VectorArithmetic[type][operator][mode](left, right);
  }
  const n = NumericTypes.vectorInfo(type)?.size || NumericTypes.matrixSize(type);
  if (
    operator === '*' &&
    !Numeric.isScalar(a) &&
    !Numeric.isScalar(b) &&
    (Numeric.isMatrix(a) || Numeric.isMatrix(b))
  ) {
    const values = Array.from({ length: Numeric.isMatrix(type) ? n * n : n }, (_, index) => {
      const row = Numeric.isMatrix(type) || Numeric.isMatrix(a) ? index % n : 0;
      const column = Numeric.isMatrix(type)
        ? Math.floor(index / n)
        : Numeric.isMatrix(b)
          ? index
          : 0;
      let sum = 0;
      for (let k = 0; k < n; k++) {
        sum +=
          Data.component(left, Numeric.isMatrix(a) ? k * n + row : k) *
          Data.component(right, Numeric.isMatrix(b) ? column * n + k : k);
      }
      return sum;
    });
    return __construct__(type, values);
  }
  const length = Numeric.isMatrix(type) ? n * n : n;
  const component = NumericTypes.vectorInfo(type)?.scalar;
  return __construct__(
    type,
    Array.from({ length }, (_, i) => {
      const x = Numeric.isScalar(a) ? left : Data.component(left, i),
        y = Numeric.isScalar(b) ? right : Data.component(right, i);
      if (component === 'i32' || component === 'u32') {
        if ((operator === '/' || operator === '%') && y === 0)
          throw new RangeError('Integer division by zero');
        const value = operator === '*' ? Math.imul(x, y) : __scalarArithmetic__[operator](x, y);
        return NumericTypes.convertComponent(value, component);
      }
      return __scalarArithmetic__[operator](x, y);
    }),
  );
}
function __calculate__(operator, values) {
  if (
    !values.some(
      (value) => Numeric.isVector(Data.dataKind(value)) || Numeric.isMatrix(Data.dataKind(value)),
    )
  )
    return __scalarArithmetic__[operator](...values);
  if (
    operator === '%' &&
    values.some(
      (value) =>
        (!NumericTypes.vectorInfo(Data.dataKind(value))?.suffix && typeof value !== 'number') ||
        Numeric.isMatrix(Data.dataKind(value)),
    )
  )
    throw new TypeError('% requires scalar numbers or typed vectors');
  if (operator === '%' && values.length !== 2)
    throw new TypeError('% expects exactly two operands');
  for (let i = 0; i < values.length; i++)
    Types.assertType(values[i], __typeOf__(values[i]), `${operator}: operand ${i + 1}`);
  if (values.length === 1) {
    const value = values[0],
      type = __typeOf__(value);
    if (operator === '+' || operator === '*') return Data.copy(value);
    if (operator === '/' && Numeric.isMatrix(type))
      throw new TypeError('Matrix division is not supported');
    if (Numeric.isVector(type))
      return VectorArithmetic[type][operator === '-' ? 'negate' : 'reciprocal'](value);
    const operation = operator === '-' ? (value) => -value : (value) => 1 / value;
    return __construct__(type, Data.values(value).map(operation));
  }
  let result = values[0];
  for (let i = 1; i < values.length; i++) result = __binary__(operator, result, values[i]);
  return result;
}
const __arithmetic__ = {
  '+': (...values) => __calculate__('+', values),
  '-': (...values) => __calculate__('-', values),
  '*': (...values) => __calculate__('*', values),
  '/': (...values) => __calculate__('/', values),
  '%': (...values) => __calculate__('%', values),
};

export const Arithmetic = { bindings: __arithmetic__ };
