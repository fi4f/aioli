import { Data } from './data.js';
import { NumericTypes } from './numeric-types.js';

function __num__(value) {
  if (arguments.length > 1) throw new TypeError('num expects at most one value');
  if (arguments.length === 0) return 0;
  if (typeof value === 'number') return NumericTypes.assertFinite(value, 'num');
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string') {
    const parts = value.trim().split(':');
    const body = parts[0].trim();
    const suffix = parts[1]?.trim();
    if (
      !body ||
      parts.length > 2 ||
      (parts.length === 2 && !Object.hasOwn(NumericTypes.scalarSuffixes, suffix))
    )
      throw new TypeError(
        'num expects a complete numeric string with an optional :i, :u, or :f suffix',
      );
    const result = Number(body);
    if (Number.isNaN(result)) throw new TypeError('num expects a complete numeric string');
    if (!Number.isFinite(result))
      throw new RangeError('num: numeric string must produce a finite number');
    return parts.length === 2
      ? NumericTypes.convertComponent(result, NumericTypes.scalarSuffixes[suffix])
      : result;
  }
  throw new TypeError('num expects num, bool, or complete numeric string');
}

function __f32__(value) {
  if (arguments.length > 1) throw new TypeError('f32 expects at most one value');
  if (arguments.length === 0) return 0;
  return NumericTypes.convertComponent(__num__(value), 'f32');
}
function __i32__(value) {
  if (arguments.length > 1) throw new TypeError('i32 expects at most one value');
  if (arguments.length === 0) return 0;
  return NumericTypes.convertComponent(__num__(value), 'i32');
}
function __u32__(value) {
  if (arguments.length > 1) throw new TypeError('u32 expects at most one value');
  if (arguments.length === 0) return 0;
  return NumericTypes.convertComponent(__num__(value), 'u32');
}
const __conversionBindings__ = {
  num: __num__,
  f32: __f32__,
  i32: __i32__,
  u32: __u32__,
  str: Data.str,
};

export const Conversions = {
  num: __num__,
  str: Data.str,
  f32: __f32__,
  i32: __i32__,
  u32: __u32__,
  bindings: __conversionBindings__,
};
