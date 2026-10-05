const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
export function validKey(key) {
  if (typeof key !== 'string' || !key || forbidden.has(key)) throw new Error('Invalid state key');
  return key;
}
/** A bounded JSON value. Collections are persistent: Lisp operations return new values. */
export function validateValue(value) {
  let remaining = 10000;
  function visit(node, depth) {
    if (--remaining < 0 || depth > 32) throw new Error('State value exceeds collection limits');
    if (node === null || typeof node === 'string' || typeof node === 'boolean') return;
    if (typeof node === 'number' && Number.isFinite(node)) return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child, depth + 1);
      return;
    }
    if (
      typeof node === 'object' &&
      [Object.prototype, null].includes(Object.getPrototypeOf(node))
    ) {
      for (const [key, child] of Object.entries(node)) {
        validKey(key);
        visit(child, depth + 1);
      }
      return;
    }
    throw new Error('State values must be finite JSON data');
  }
  visit(value, 0);
  return value;
}
export function validateState(state) {
  if (
    !state ||
    typeof state !== 'object' ||
    Array.isArray(state) ||
    Object.keys(state).length > 256
  )
    throw new Error('Invalid state');
  for (const [key, value] of Object.entries(state)) {
    validKey(key);
    validateValue(value);
  }
  return state;
}

export function equalValues(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  validateValue(a);
  validateValue(b);
  const equal = (left, right) => {
    if (left === right) return true;
    if (
      left === null ||
      right === null ||
      typeof left !== 'object' ||
      typeof right !== 'object' ||
      Array.isArray(left) !== Array.isArray(right)
    )
      return false;
    const keys = Object.keys(left);
    return (
      keys.length === Object.keys(right).length &&
      keys.every((key) => Object.hasOwn(right, key) && equal(left[key], right[key]))
    );
  };
  return equal(a, b);
}
