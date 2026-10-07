import { arithmetic } from './arithmetic.js';
import { vectorBindings, matrixBindings, typeGuardBindings } from './types.js';
import { dataBindings } from './data.js';
import { conversionBindings } from './conversions.js';
import { transformBindings } from './transforms.js';
import { blend } from './colors.js';
import { mathBindings } from './math.js';
import { promiseBindings } from './promises.js';

// Add application functions or values here; no compiler changes needed.
export const bindings = {
  ...arithmetic,
  ...vectorBindings,
  ...matrixBindings,
  ...typeGuardBindings,
  ...dataBindings,
  ...conversionBindings,
  ...transformBindings,
  ...mathBindings,
  ...promiseBindings,
  blend,
  ...Object.fromEntries(Object.entries({
    '<': (a, b) => a < b, '>': (a, b) => a > b,
    '<=': (a, b) => a <= b, '>=': (a, b) => a >= b,
  }).map(([name, compare]) => [name, (...values) => {
    if (values.length !== 2 || values.some(value => typeof value !== 'number')) throw new TypeError(`${name} expects exactly two numeric scalars`);
    return compare(...values);
  }])),
  print: (...values) => console.log(...values),
};
