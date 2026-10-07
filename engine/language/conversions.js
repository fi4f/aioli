import { normalizeNil } from './data.js';
import { convertComponent } from './numeric-types.js';

const decimal = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

export function num(value) {
  if (arguments.length !== 1) throw new TypeError('num expects exactly one value');
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string') {
    const text = value.trim();
    if (text === 'NaN') return NaN;
    if (text === 'Infinity' || text === '+Infinity') return Infinity;
    if (text === '-Infinity') return -Infinity;
    if (decimal.test(text)) {
      const result = Number(text);
      if (!Number.isFinite(result)) throw new RangeError('num: numeric string overflows; use Infinity explicitly');
      return result;
    }
  }
  throw new TypeError('num expects num, bool, or complete numeric string');
}

export function str(value) {
  if (arguments.length !== 1) throw new TypeError('str expects exactly one value');
  value = normalizeNil(value);
  if (value === null) return 'nil';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Object.is(value, -0) ? '-0' : String(value);
  throw new TypeError('str expects nil, num, bool, or str; use to-json for collections');
}

export function f32(value) {
  if (arguments.length !== 1) throw new TypeError('f32 expects exactly one value');
  return Math.fround(num(value));
}
export function i32(value) {
  if (arguments.length !== 1) throw new TypeError('i32 expects exactly one value');
  return convertComponent(num(value), 'i32');
}
export function u32(value) {
  if (arguments.length !== 1) throw new TypeError('u32 expects exactly one value');
  return convertComponent(num(value), 'u32');
}
export const conversionBindings = { num, f32, i32, u32, str };
