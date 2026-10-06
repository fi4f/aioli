import { functionInfo, stateInfo } from './metadata.js';
import { validKey, validateValue, equalValues } from './state-values.js';
// Shared reader and CPU runtime. Shader compilation consumes the same AST.
let execution = null;
export const sym = (name) => ({ type: 'symbol', name });
export const isSym = (v, name) => v?.type === 'symbol' && (name === undefined || v.name === name);
/** Read strict Lisp AST forms. Incomplete source is handled by source-tokens.js. */
export function parse(source) {
  const tokens = [];
  let i = 0,
    line = 1;
  while (i < source.length) {
    const c = source[i];
    if (/\s/.test(c)) {
      if (c === '\n') line++;
      i++;
      continue;
    }
    if (c === ';') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if ('()[]'.includes(c)) {
      tokens.push({ value: c, line });
      i++;
      continue;
    }
    if (c === '"') {
      const start = i++,
        startLine = line;
      let closed = false;
      while (i < source.length) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if (source[i] === '"') {
          i++;
          closed = true;
          break;
        }
        if (source[i++] === '\n') line++;
      }
      if (!closed) throw new Error(`Line ${startLine}: unterminated string`);
      try {
        tokens.push({
          value: { type: 'string', value: JSON.parse(source.slice(start, i)) },
          line: startLine,
        });
      } catch {
        throw new Error(`Line ${startLine}: invalid string escape`);
      }
      continue;
    }
    const start = i;
    while (i < source.length && !/[\s()[\];]/.test(source[i])) i++;
    tokens.push({ value: source.slice(start, i), line });
  }
  let index = 0;
  // Lists are arrays; vectors, strings, and symbols carry explicit type tags.
  // The same AST is consumed by the CPU interpreter and WGSL compiler.
  function read() {
    const token = tokens[index++];
    if (!token) throw new Error('Unexpected end of source');
    const { value: v, line: l } = token;
    if (v === '(' || v === '[') {
      const items = [],
        end = v === '(' ? ')' : ']';
      while (tokens[index]?.value !== end) {
        if (!tokens[index]) throw new Error(`Line ${l}: missing ${end}`);
        items.push(read());
      }
      index++;
      const node = v === '(' ? items : { type: 'vector', items };
      Object.defineProperty(node, 'location', { value: { line: l } });
      return node;
    }
    if (v === ')' || v === ']') throw new Error(`Line ${l}: unexpected ${v}`);
    if (typeof v === 'object') return v;
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(v)) {
      const n = Number(v);
      if (!Number.isFinite(n)) throw new Error(`Line ${l}: invalid number`);
      return n;
    }
    return sym(v);
  }
  const forms = [];
  while (index < tokens.length) forms.push(read());
  return forms;
}
export function print(node) {
  if (Array.isArray(node)) return '(' + node.map(print).join(' ') + ')';
  if (node?.type === 'vector') return '[' + node.items.map(print).join(' ') + ']';
  if (node?.type === 'string') return JSON.stringify(node.value);
  if (isSym(node)) return node.name;
  return String(node);
}
/**
 * Evaluate CPU Lisp with lexical environments and a bounded instruction budget.
 * state is the shared project state. host supplies browser/drawing services,
 * which keeps the language implementation independent of DOM and WebGPU APIs.
 */
export function createRuntime(state, host = {}) {
  let definitionVersion = 0;
  const global = Object.create(null),
    budget = host.budget ?? 10000;
  const stateKeys = new Set(),
    definitions = new Map(),
    fields = new Map();
  let sourcePath = '';
  const collection = (value) => {
    if (!Array.isArray(value) || value.length > 10000) throw new Error('Expected a bounded vector');
    return value;
  };
  const invoke = (fn, ...args) => {
    consume();
    if (typeof fn !== 'function') throw new Error('Expected a function');
    return fn(...args);
  };
  const fallback = { remaining: budget, state, keys: stateKeys, fields };
  const consume = () => {
    if (--(execution ?? fallback).remaining < 0) throw new Error('Evaluation budget exceeded');
  };
  const run = (fn) => {
    const previous = execution;
    execution = { remaining: budget, state, keys: stateKeys, fields };
    try {
      return fn();
    } finally {
      execution = previous;
    }
  };
  const numeric =
    (name, fn) =>
    (...args) => {
      if (!args.every((v) => typeof v === 'number' && Number.isFinite(v)))
        throw new Error(`${name}: expected finite numbers`);
      const value = fn(...args);
      if (!Number.isFinite(value)) throw new Error(`${name}: non-finite result`);
      return value;
    };
  Object.assign(global, {
    '+': numeric('+', (...a) => a.reduce((x, y) => x + y, 0)),
    '-': numeric('-', (x, ...a) => (a.length ? a.reduce((v, y) => v - y, x) : -x)),
    '*': numeric('*', (...a) => a.reduce((x, y) => x * y, 1)),
    '/': numeric('/', (x, ...a) => a.reduce((v, y) => v / y, x)),
    sin: numeric('sin', Math.sin),
    cos: numeric('cos', Math.cos),
    abs: numeric('abs', Math.abs),
    min: numeric('min', Math.min),
    max: numeric('max', Math.max),
    floor: numeric('floor', Math.floor),
    clamp: numeric('clamp', (x, a, b) => Math.min(b, Math.max(a, x))),
    round: numeric('round', Math.round),
    mod: numeric('mod', (x, y) => ((x % y) + y) % y),
    str: (...values) => values.map(String).join(''),
    count: (x) =>
      x == null ? 0 : Array.isArray(x) || typeof x === 'string' ? x.length : Object.keys(x).length,
    vector: (...values) => values,
    range: (count) => {
      if (!Number.isInteger(count) || count < 0 || count > 10000)
        throw new Error('range requires 0–10000');
      return Array.from({ length: count }, (_, i) => i);
    },
    type: (value) => (value === null ? 'nil' : Array.isArray(value) ? 'vector' : typeof value),
    'json-read': (text) => validateValue(JSON.parse(text)),
    'json-write': (value) => JSON.stringify(validateValue(value)),
    'vector?': Array.isArray,
    'number?': (value) => typeof value === 'number' && Number.isFinite(value),
    'string?': (value) => typeof value === 'string',
    'boolean?': (value) => typeof value === 'boolean',
    'integer?': Number.isInteger,
    map: (...pairs) => {
      if (pairs.length % 2) throw new Error('map expects key/value pairs');
      const value = Object.create(null);
      for (let i = 0; i < pairs.length; i += 2) value[validKey(pairs[i])] = pairs[i + 1];
      return value;
    },
    lookup: (value, key, fallback = null) =>
      value != null && Object.hasOwn(value, key) ? value[key] : fallback,
    assoc: (value, key, entry) => ({ ...value, [validKey(key)]: entry }),
    dissoc: (value, key) => {
      const result = { ...value };
      delete result[validKey(key)];
      return result;
    },
    merge: (...values) => Object.assign(Object.create(null), ...values),
    keys: (value) => Object.keys(value),
    values: (value) => Object.values(value),
    'contains?': (value, key) =>
      Array.isArray(value)
        ? value.some((entry) => equalValues(entry, key))
        : value != null && Object.hasOwn(value, key),
    conj: (value, entry) => [...collection(value), entry],
    concat: (...values) => values.flatMap(collection),
    slice: (value, start, end) => value.slice(start, end),
    distinct: (value) => [...new Set(collection(value))],
    'index-of': (value, entry) => value.indexOf(entry),
    mapv: (fn, value) => collection(value).map((entry) => invoke(fn, entry)),
    filter: (fn, value) => collection(value).filter((entry) => invoke(fn, entry)),
    reduce: (fn, initial, value) =>
      collection(value).reduce((result, entry) => invoke(fn, result, entry), initial),
    sort: (value, fn = (a, b) => String(a).localeCompare(String(b))) =>
      [...collection(value)].sort((a, b) => invoke(fn, a, b)),
    compare: (a, b) => String(a).localeCompare(String(b)),
    split: (value, separator) => value.split(separator),
    join: (value, separator = '') => collection(value).join(separator),
    'starts-with?': (value, prefix) => typeof value === 'string' && value.startsWith(prefix),
    'ends-with?': (value, suffix) => typeof value === 'string' && value.endsWith(suffix),
    'lower-case': (value) => value.toLowerCase(),
    trim: (value) => value.trim(),
    'includes?': (value, item) => value.includes(item),
    'replace-pattern': (value, pattern, replacement) =>
      value.replace(new RegExp(pattern), replacement),
    'parse-number': (value) => {
      if (typeof value !== 'string' || value.trim() === '' || !Number.isFinite(Number(value)))
        throw new Error('Expected a finite number');
      return Number(value);
    },
    precision: (value, digits) => Number(value.toPrecision(digits)),
    'matches?': (value, pattern) => new RegExp(pattern, 'i').test(value),
    error: (message) => {
      throw new Error(message);
    },
    'state-metadata': () => [...fields.values()],
    definitions: () => [...definitions.values()],
    nth: (xs, i) => {
      if (!Number.isInteger(i) || i < 0 || i >= xs.length)
        throw new Error('nth: index out of bounds');
      return xs[i];
    },
    '<': (a, b) => a < b,
    '>': (a, b) => a > b,
    '<=': (a, b) => a <= b,
    '>=': (a, b) => a >= b,
    '=': equalValues,
    not: (x) => !x,
    get: (key) => {
      stateKeys.add(key);
      if (execution?.state === state) {
        execution.keys.add(key);
        if (!execution.fields.has(key) && fields.has(key))
          execution.fields.set(key, fields.get(key));
      }
      if (!(key in state)) throw new Error(`Unknown state :${key}`);
      return state[key];
    },
    'key?': (key) => host.key?.(key) ?? false,
    voice: (...args) => host.voice?.(...args),
    'play-sound': (...args) => host.playSound?.(...args),
    'export-wav': () => host.exportWav?.(),
    true: true,
    false: false,
    nil: null,
  });
  Object.assign(global, host.primitives || {});
  function evaluate(node, env = global) {
    consume();
    if (typeof node === 'number') return node;
    if (node?.type === 'string') return node.value;
    if (node?.type === 'vector') return node.items.map((n) => evaluate(n, env));
    if (isSym(node)) {
      if (node.name.startsWith(':')) return node.name.slice(1);
      if (node.name in env) return env[node.name];
      throw new Error(`Unknown symbol ${node.name}`);
    }
    if (!Array.isArray(node) || !node.length) throw new Error('Expected a nonempty expression');
    const [head, ...args] = node,
      name = head?.name;
    const ev = (n) => evaluate(n, env),
      body = (nodes) => {
        let value;
        for (const n of nodes) value = ev(n);
        return value;
      };
    // Special forms control evaluation order; ordinary calls evaluate arguments.
    if (['defn', 'defdraw', 'defsound', 'fn'].includes(name)) {
      const anonymous = name === 'fn';
      const definition = anonymous ? [sym('defn'), sym('anonymous'), ...args] : node;
      const hook = functionInfo(definition, sourcePath);
      const parts = definition.slice(1);
      if (!isSym(parts[0]) || parts[1]?.type !== 'vector' || !parts[1].items.every((n) => isSym(n)))
        throw new Error('Use (defn name [arguments] body...)');
      const params = parts[1].items.map((n) => n.name),
        closure = env;
      const fn = (...values) => {
        if (values.length !== params.length)
          throw new Error(`${parts[0].name}: expected ${params.length} arguments`);
        // Prototype-linked environments implement lexical lookup, not mutation
        // of an outer binding. Shared mutation must go through set! explicitly.
        const local = Object.create(closure);
        params.forEach((p, i) => (local[p] = values[i]));
        const previousPath = sourcePath;
        sourcePath = hook.path;
        try {
          let result;
          for (const n of parts.slice(hook.bodyOffset - 1)) result = evaluate(n, local);
          return result;
        } finally {
          sourcePath = previousPath;
        }
      };
      fn.hook = hook;
      if (anonymous) return fn;
      env[parts[0].name] = fn;
      definitions.set(hook.name, hook);
      definitionVersion++;
      return null;
    }
    if (name === 'pixels') {
      if (!host.pixels) throw new Error('pixels requires a drawing host');
      return host.pixels(args, env, ev);
    }
    if (name === 'do') return body(args);
    if (name === 'scope') {
      host.beginScope?.();
      try {
        return body(args);
      } finally {
        host.endScope?.();
      }
    }
    if (name === 'repeat') {
      const count = ev(args[0]);
      if (!Number.isInteger(count) || count < 0 || count > 64 || !isSym(args[1]))
        throw new Error('repeat: count 0–64 and a symbol required');
      let result;
      for (let i = 0; i < count; i++) {
        const local = Object.create(env);
        local[args[1].name] = i;
        for (const n of args.slice(2)) result = evaluate(n, local);
      }
      return result;
    }
    if (name === 'if') {
      if (args.length < 2 || args.length > 3)
        throw new Error('if expects condition, true branch, optional false branch');
      return ev(args[0]) ? ev(args[1]) : args[2] === undefined ? null : ev(args[2]);
    }
    if (name === 'cond') {
      if (args.length % 2) throw new Error('cond expects condition/expression pairs');
      for (let i = 0; i < args.length; i += 2) if (ev(args[i])) return ev(args[i + 1]);
      return null;
    }
    if (name === 'when') return ev(args[0]) ? body(args.slice(1)) : null;
    if (name === 'and') {
      for (const n of args) if (!ev(n)) return false;
      return true;
    }
    if (name === 'or') {
      for (const n of args) if (ev(n)) return true;
      return false;
    }
    // State must stay JSON-compatible for project export and local persistence.
    if (name === 'set!' || name === 'init!') {
      // An init! annotation describes inspector controls without evaluating it.
      if (
        args.length !== 2 &&
        !(name === 'init!' && args.length === 3 && args[2]?.type === 'vector')
      )
        throw new Error(`${name} expects a state key and value`);
      const key = ev(args[0]);
      validKey(key);
      stateKeys.add(key);
      const info = name === 'init!' ? stateInfo(node, sourcePath, key) : null;
      if (name === 'init!' && key in state) {
        if (info.computed) info.value = state[key];
        fields.set(key, info);
        return state[key];
      }
      const value = ev(args[1]);
      if (info) {
        if (info.computed) info.value = value;
        fields.set(key, info);
      }
      validateValue(value);
      state[key] = value;
      return value;
    }
    if (name === 'let') {
      if (args[0]?.type !== 'vector' || args[0].items.length % 2)
        throw new Error('let expects [name value ...]');
      const local = Object.create(env),
        bindings = args[0].items;
      for (let i = 0; i < bindings.length; i += 2) {
        if (!isSym(bindings[i])) throw new Error('Invalid let binding');
        local[bindings[i].name] = evaluate(bindings[i + 1], local);
      }
      let result;
      for (const n of args.slice(1)) result = evaluate(n, local);
      return result;
    }
    const fn = ev(head);
    if (typeof fn !== 'function') throw new Error(`${name || print(head)} is not callable`);
    return fn(...args.map(ev));
  }
  return {
    state,
    stateKeys,
    global,
    metadata: { definitions, fields },
    get definitionVersion() {
      return definitionVersion;
    },
    load(forms, path = '') {
      sourcePath = path;
      run(() => {
        for (const node of forms) evaluate(node);
      });
    },
    call(name, ...args) {
      return run(() => {
        if (typeof global[name] !== 'function') throw new Error(`Missing (defn ${name} [...])`);
        return global[name](...args);
      });
    },
    invoke(name, ...args) {
      const fn = () => {
        if (typeof global[name] !== 'function') throw new Error(`Missing function ${name}`);
        return global[name](...args);
      };
      return execution ? fn() : run(fn);
    },
    evaluate(node) {
      return run(() => evaluate(node));
    },
  };
}
