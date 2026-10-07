import { arithmetic } from './arithmetic.js';
import { vectorBindings, matrixBindings, typeGuardBindings } from './types.js';
import { dataBindings } from './data.js';
import { conversionBindings } from './conversions.js';
import { transformBindings } from './transforms.js';

// Add application functions or values here; no compiler changes needed.
export const bindings = {
  ...arithmetic,
  ...vectorBindings,
  ...matrixBindings,
  ...typeGuardBindings,
  ...dataBindings,
  ...conversionBindings,
  ...transformBindings,
  print: (...values) => console.log(...values),
};
