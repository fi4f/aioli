import { arithmetic } from './arithmetic.js';
import { vectorBindings } from './types.js';

// Add application functions or values here; no compiler changes needed.
export const bindings = {
  ...arithmetic,
  ...vectorBindings,
  print: (...values) => console.log(...values),
  greet: name => `Hello, ${name}!`,
};
