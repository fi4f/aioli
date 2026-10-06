import { assertType } from './types.js';

function numbers(name, values, minimum = 0, maximum = Infinity) {
  if (values.length < minimum || values.length > maximum) {
    throw new TypeError(`${name}: expected ${minimum === maximum ? minimum : `at least ${minimum}`} operands`);
  }
  for (let i = 0; i < values.length; i++) {
    assertType(values[i], 'number', `${name}: operand ${i + 1}`);
  }
}

export const arithmetic = {
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
