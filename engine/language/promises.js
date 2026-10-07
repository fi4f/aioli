import { registerOpaque, normalizeNil, dict, list, dataKind } from './data.js';

const promises = new WeakSet(), errors = new WeakMap();
const functions = new WeakMap();
export const isPromise = value => promises.has(value) || value instanceof Promise;
export function registerPromise(value) { promises.add(value); return registerOpaque(value); }
export function promiseError(reason) {
  const value = dict('name', reason instanceof Error ? reason.name : 'Error', 'message', reason instanceof Error ? reason.message : String(reason));
  errors.set(value, reason); return value;
}
const requireArity = (name, values, count) => { if (values.length !== count) throw new TypeError(`${name} expects ${count} arguments`); };
export const promiseBindings = {
  'async?': (...values) => { requireArity('async?',values,1); return isPromise(values[0]); },
  'async-all': (...values) => { requireArity('async-all',values,1); if(dataKind(values[0])!=='list')throw new TypeError('async-all expects a list'); return registerPromise(Promise.all(values[0].values).then(items=>list(...items.map(normalizeNil)))); },
  'async-race': (...values) => { requireArity('async-race',values,1); if(dataKind(values[0])!=='list')throw new TypeError('async-race expects a list'); return registerPromise(Promise.race(values[0].values).then(normalizeNil)); },
  throw: (...values) => {
    requireArity('throw',values,1);
    const reason = errors.has(values[0]) ? errors.get(values[0]) : values[0];
    throw reason instanceof Error ? reason : new Error(String(reason));
  },
};
export const promiseRuntime = { mark: registerPromise, error: promiseError,
  fn: fn => (...args) => registerPromise(fn(...args)),
  define(fn, arity, asynchronous) {
    const value = asynchronous ? (...args) => registerPromise(fn(...args)) : fn;
    functions.set(value, { arity, asynchronous }); return value;
  },
  callback(fn, name, maximum, allowAsync) {
    if (typeof fn !== 'function') throw new TypeError(`${name} callback expects a function`);
    const info = functions.get(fn) ?? { arity: fn.length, asynchronous: fn.constructor?.name === 'AsyncFunction' };
    if (info.arity > maximum) throw new TypeError(`${name} accepts ${maximum ? 'at most one parameter' : 'no parameters'}`);
    if (!allowAsync && info.asynchronous) throw new TypeError(`${name} callback must remain synchronous`);
    return fn;
  },
};
