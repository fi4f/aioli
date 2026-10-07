import { vectorInfo, matrixSize } from './numeric-types.js';
export const isMatrix = type => Boolean(matrixSize(type));
export const isVector = type => Boolean(vectorInfo(type));
export const isScalar = type => ['num', 'f32', 'i32', 'u32'].includes(type);
export function resultType(operator, left, right) {
  const a = vectorInfo(left), b = vectorInfo(right);
  if (isMatrix(left) || isMatrix(right)) {
    if (operator === '*' && (['num','f32'].includes(left) || ['num','f32'].includes(right))) return isMatrix(left) ? left : right;
    const size = type => vectorInfo(type)?.size || matrixSize(type);
    if (operator === '*' && size(left) === size(right) && (!a || ['num','f32'].includes(a.scalar)) && (!b || ['num','f32'].includes(b.scalar))) return a ? left : b ? right : left;
    if (['+', '-'].includes(operator) && left === right) return left;
    throw new TypeError(operator + ': incompatible matrix operands ' + left + ' and ' + right);
  }
  if (left === right) return left;
  const compatible = (scalar, component) => scalar === component || ['num','f32'].includes(scalar) && ['num','f32'].includes(component);
  if (isScalar(left) && b && compatible(left,b.scalar)) return right;
  if (isScalar(right) && a && compatible(right,a.scalar)) return left;
  if (isScalar(left) && isScalar(right) && compatible(left,right)) return left === 'f32' || right === 'f32' ? 'f32' : left;
  throw new TypeError(operator + ': numeric types and vector dimensions must match');
}
