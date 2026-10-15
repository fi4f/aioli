import { Arithmetic } from './arithmetic.js';
import { Types } from './types.js';
import { Data } from './data.js';
import { Conversions } from './conversions.js';
import { Transforms } from './transforms.js';
import { Colors } from './colors.js';
import { Maths } from './math.js';
import { Promises } from './promises.js';
import { Events } from './events.js';
import { Layout } from './layout.js';

// Add application functions or values here; no compiler changes needed.
const __bindings__ = {
  Events,
  Layout,
  Colors,
  ...Arithmetic.bindings,
  ...Types.vectorBindings,
  ...Types.matrixBindings,
  ...Types.typeGuardBindings,
  ...Data.dataBindings,
  ...Conversions.bindings,
  ...Transforms.bindings,
  ...Maths.bindings,
  ...Promises.bindings,
  blend: Colors.blend,
  '<': (...values) => __compare__('<', (a, b) => a < b, values),
  '>': (...values) => __compare__('>', (a, b) => a > b, values),
  '<=': (...values) => __compare__('<=', (a, b) => a <= b, values),
  '>=': (...values) => __compare__('>=', (a, b) => a >= b, values),
  print: (...values) => console.log(...values),
};

export const Bindings = __bindings__;

function __compare__(name, compare, values) {
  if (values.length !== 2 || values.some((value) => !Number.isFinite(value)))
    throw new TypeError(`${name} expects exactly two finite numeric scalars`);
  return compare(...values);
}
