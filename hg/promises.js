import { Data } from './data.js';
import { Errors } from './errors.js';

const __promises__ = new WeakSet();
const __functions__ = new WeakMap();
const __isPromise__ = (value) => __promises__.has(value) || value instanceof Promise;
function __registerPromise__(value) {
  __promises__.add(value);
  return Data.registerOpaque(value);
}
const __promiseError__ = Errors.from;
const __requireArity__ = (name, values, count) => {
  if (values.length !== count) throw new TypeError(`${name} expects ${count} arguments`);
};
function __async__(fn) {
  if (typeof fn !== 'function') throw new TypeError('async expects a function');
  const arity = __functions__.get(fn)?.arity ?? fn.length;
  return __promiseRuntime__.define(async (...args) => fn(...args), arity, true);
}
function __stage__(body, deferred = false) {
  let resolve, reject;
  const promise = __registerPromise__(
    new Promise((success, failure) => {
      resolve = success;
      reject = failure;
    }),
  );
  const settlement = {
    resolve(value) {
      resolve(Data.normalizeNil(value));
      return null;
    },
    reject(reason = null) {
      reject(reason);
      return null;
    },
  };
  const run = () => {
    try {
      Promise.resolve(body(settlement)).then(settlement.resolve, settlement.reject);
    } catch (error) {
      settlement.reject(error);
    }
  };
  if (deferred) Promise.resolve().then(run);
  else run();
  return promise;
}
const __promiseBindings__ = {
  'async?': (...values) => {
    __requireArity__('async?', values, 1);
    return __isPromise__(values[0]);
  },
  'async-all': (...values) => {
    __requireArity__('async-all', values, 1);
    if (Data.dataKind(values[0]) !== 'list') throw new TypeError('async-all expects a list');
    return __registerPromise__(
      Promise.all(Data.values(values[0])).then((items) =>
        Data.list(...items.map(Data.normalizeNil)),
      ),
    );
  },
  'async-race': (...values) => {
    __requireArity__('async-race', values, 1);
    if (Data.dataKind(values[0]) !== 'list') throw new TypeError('async-race expects a list');
    return __registerPromise__(Promise.race(Data.values(values[0])).then(Data.normalizeNil));
  },
};
const __promiseRuntime__ = {
  mark: __registerPromise__,
  stage: __stage__,
  error: __promiseError__,
  fn: __async__,
  define(fn, arity, asynchronous) {
    const value = asynchronous ? (...args) => __registerPromise__(fn(...args)) : fn;
    __functions__.set(value, { arity, asynchronous });
    return value;
  },
  callback(fn, name, maximum, allowAsync) {
    if (typeof fn !== 'function') throw new TypeError(`${name} callback expects a function`);
    const info = __functions__.get(fn) ?? {
      arity: fn.length,
      asynchronous: fn.constructor?.name === 'AsyncFunction',
    };
    if (info.arity > maximum)
      throw new TypeError(`${name} accepts ${maximum ? 'at most one parameter' : 'no parameters'}`);
    if (!allowAsync && info.asynchronous)
      throw new TypeError(`${name} callback must remain synchronous`);
    return fn;
  },
};

export const Promises = {
  async: __async__,
  isPromise: __isPromise__,
  registerPromise: __registerPromise__,
  promiseError: __promiseError__,
  bindings: __promiseBindings__,
  runtime: __promiseRuntime__,
};
