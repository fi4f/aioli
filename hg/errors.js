import { Data } from './data.js';

const __origins__ = new WeakMap();
function __new__(message = '', name = 'Error') {
  if (typeof name !== 'string' || typeof message !== 'string')
    throw new TypeError('Error name and message must be strings');
  return Data.registerData({ __type__: '__error__', name, message }, 'error');
}
function __isError__(value) {
  return (
    Data.dataKind(value) === 'error' &&
    Object.hasOwn(value, '__type__') &&
    Object.hasOwn(value, 'name') &&
    Object.hasOwn(value, 'message') &&
    value.__type__ === '__error__' &&
    typeof value.name === 'string' &&
    typeof value.message === 'string'
  );
}
function __from__(reason) {
  if (__isError__(reason)) return reason;
  if (reason instanceof Error) {
    const value = __new__(String(reason.message), String(reason.name));
    __origins__.set(value, reason);
    return value;
  }
  if (
    Data.dataKind(reason) === 'dict' &&
    Object.hasOwn(reason, '__type__') &&
    reason.__type__ === '__error__' &&
    Object.hasOwn(reason, 'name') &&
    typeof reason.name === 'string' &&
    Object.hasOwn(reason, 'message') &&
    typeof reason.message === 'string'
  )
    return __new__(reason.message, reason.name);
  return __new__(String(reason));
}
function __toNative__(value) {
  if (value instanceof Error) return value;
  if (!__isError__(value)) return new Error(String(value));
  const origin = __origins__.get(value);
  if (origin && origin.name === value.name && origin.message === value.message) return origin;
  const error = new Error(value.message);
  error.name = value.name;
  if (origin?.lisp) error.lisp = origin.lisp;
  return error;
}

export const Errors = {
  new: __new__,
  from: __from__,
  isError: __isError__,
  toNative: __toNative__,
};
