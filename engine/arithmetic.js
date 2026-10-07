import { assertType } from './types.js';
import { copy, dataKind, vector, matrix } from './data.js';
import { resultType, isMatrix, isVector, isScalar } from './numeric.js';
import { vectorInfo, convertComponent, matrixSize } from './numeric-types.js';
import { vectorArithmetic } from './arithmetic.generated.js';

function numbers(name, values, minimum = 0, maximum = Infinity) {
  if (values.length < minimum || values.length > maximum) {
    throw new TypeError(`${name}: expected ${minimum === maximum ? minimum : `at least ${minimum}`} operands`);
  }
  for (let i = 0; i < values.length; i++) {
    assertType(values[i], 'num', `${name}: operand ${i + 1}`);
  }
}

const scalarArithmetic = {
  '+': (...values) => {
    numbers('+', values);
    let result = 0;
    for (const value of values) result += value;
    return result;
  },
  '-': (...values) => {
    numbers('-', values, 1);
    if (values.length === 1) return -values[0];
    let result = values[0];
    for (let i = 1; i < values.length; i++) result -= values[i];
    return result;
  },
  '*': (...values) => {
    numbers('*', values);
    let result = 1;
    for (const value of values) result *= value;
    return result;
  },
  '/': (...values) => {
    numbers('/', values, 1);
    if (values.length === 1) return 1 / values[0];
    let result = values[0];
    for (let i = 1; i < values.length; i++) result /= values[i];
    return result;
  },
  '%': (...values) => {
    numbers('%', values, 2, 2);
    return values[0] % values[1];
  },
};

const typeOf = value => dataKind(value) || 'num';
const construct = (type, values) => isMatrix(type) ? matrix(matrixSize(type), values) : vector(vectorInfo(type).size, values, type);
function binary(operator, left, right) {
  let a = typeOf(left), b = typeOf(right);
  if (a === 'num' && vectorInfo(b)?.suffix) { a = vectorInfo(b).scalar; if (a === 'f32') left = Math.fround(left); assertType(left, a); }
  if (b === 'num' && vectorInfo(a)?.suffix) { b = vectorInfo(a).scalar; if (b === 'f32') right = Math.fround(right); assertType(right, b); }
  const type = resultType(operator, a, b);
  if (type === 'num') return scalarArithmetic[operator](left, right);
  if (!isMatrix(a) && !isMatrix(b)) {
    const mode = isScalar(a) ? 'sv' : isScalar(b) ? 'vs' : 'vv';
    return vectorArithmetic[type][operator][mode](left, right);
  }
  const n = vectorInfo(type)?.size || matrixSize(type);
  if (operator === '*' && !isScalar(a) && !isScalar(b) && (isMatrix(a) || isMatrix(b))) {
    const values = Array.from({ length: isMatrix(type) ? n * n : n }, (_, index) => {
      const row = isMatrix(type) || isMatrix(a) ? index % n : 0;
      const column = isMatrix(type) ? Math.floor(index / n) : isMatrix(b) ? index : 0;
      let sum = 0;
      for (let k = 0; k < n; k++) {
        sum += (isMatrix(a) ? left.values[k * n + row] : left.values[k]) *
          (isMatrix(b) ? right.values[column * n + k] : right.values[k]);
      }
      return sum;
    });
    return construct(type, values);
  }
  const length = isMatrix(type) ? n * n : n;
  const component = vectorInfo(type)?.scalar;
  return construct(type, Array.from({ length }, (_, i) => {
    const x = isScalar(a) ? left : left.values[i], y = isScalar(b) ? right : right.values[i];
    if (component === 'i32' || component === 'u32') {
      if ((operator === '/' || operator === '%') && y === 0) throw new RangeError('Integer division by zero');
      const value = operator === '*' ? Math.imul(x, y) : scalarArithmetic[operator](x, y);
      return convertComponent(value, component);
    }
    return scalarArithmetic[operator](x, y);
  }));
}
function calculate(operator, values) {
  if (!values.some(value => isVector(dataKind(value)) || isMatrix(dataKind(value)))) return scalarArithmetic[operator](...values);
  if (operator === '%' && values.some(value => !vectorInfo(dataKind(value))?.suffix && typeof value !== 'number' || isMatrix(dataKind(value)))) throw new TypeError('% requires scalar numbers or typed vectors');
  if (operator === '%' && values.length !== 2) throw new TypeError('% expects exactly two operands');
  for (let i = 0; i < values.length; i++) assertType(values[i], typeOf(values[i]), `${operator}: operand ${i + 1}`);
  if (values.length === 1) {
    const value = values[0], type = typeOf(value);
    if (operator === '+' || operator === '*') return copy(value);
    if (operator === '/' && isMatrix(type)) throw new TypeError('Matrix division is not supported');
    if (isVector(type)) return vectorArithmetic[type][operator === '-' ? 'negate' : 'reciprocal'](value);
    const operation = operator === '-' ? value => -value : value => 1 / value;
    return construct(type, value.values.map(operation));
  }
  let result = values[0];
  for (let i = 1; i < values.length; i++) result = binary(operator, result, values[i]);
  return result;
}
export const arithmetic = Object.fromEntries(Object.keys(scalarArithmetic).map(operator =>
  [operator, (...values) => calculate(operator, values)]));
