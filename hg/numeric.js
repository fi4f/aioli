import { NumericTypes } from './numeric-types.js';
const __isMatrix__ = (type) => Boolean(NumericTypes.matrixSize(type));
const __isVector__ = (type) => Boolean(NumericTypes.vectorInfo(type));
const __isScalar__ = (type) => ['num', 'f32', 'i32', 'u32'].includes(type);
function __resultType__(operator, left, right) {
  const a = NumericTypes.vectorInfo(left),
    b = NumericTypes.vectorInfo(right);
  if (__isMatrix__(left) || __isMatrix__(right)) {
    if (operator === '*' && (['num', 'f32'].includes(left) || ['num', 'f32'].includes(right)))
      return __isMatrix__(left) ? left : right;
    const size = (type) => NumericTypes.vectorInfo(type)?.size || NumericTypes.matrixSize(type);
    if (
      operator === '*' &&
      size(left) === size(right) &&
      (!a || ['num', 'f32'].includes(a.scalar)) &&
      (!b || ['num', 'f32'].includes(b.scalar))
    )
      return a ? left : b ? right : left;
    if (['+', '-'].includes(operator) && left === right) return left;
    throw new TypeError(operator + ': incompatible matrix operands ' + left + ' and ' + right);
  }
  if (left === right) return left;
  const compatible = (scalar, component) =>
    scalar === component || (['num', 'f32'].includes(scalar) && ['num', 'f32'].includes(component));
  if (__isScalar__(left) && b && compatible(left, b.scalar)) return right;
  if (__isScalar__(right) && a && compatible(right, a.scalar)) return left;
  if (__isScalar__(left) && __isScalar__(right) && compatible(left, right))
    return left === 'f32' || right === 'f32' ? 'f32' : left;
  throw new TypeError(operator + ': numeric types and vector dimensions must match');
}

export const Numeric = {
  isMatrix: __isMatrix__,
  isVector: __isVector__,
  isScalar: __isScalar__,
  resultType: __resultType__,
};
