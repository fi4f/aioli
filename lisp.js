// Shared reader and CPU runtime. Shader compilation consumes the same AST.
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
      return v === '(' ? items : { type: 'vector', items };
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
  const global = Object.create(null),
    budget = host.budget ?? 10000;
  let fuel = budget;
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
    count: (x) => x.length,
    nth: (xs, i) => {
      if (!Number.isInteger(i) || i < 0 || i >= xs.length)
        throw new Error('nth: index out of bounds');
      return xs[i];
    },
    '<': (a, b) => a < b,
    '>': (a, b) => a > b,
    '<=': (a, b) => a <= b,
    '>=': (a, b) => a >= b,
    '=': (a, b) => a === b,
    not: (x) => !x,
    get: (key) => {
      if (!(key in state)) throw new Error(`Unknown state :${key}`);
      return state[key];
    },
    'key?': (key) => host.key?.(key) ?? false,
    voice: (...args) => host.voice?.(...args),
    'play-sound': () => host.playSound?.(),
    'export-wav': () => host.exportWav?.(),
    true: true,
    false: false,
    nil: null,
  });
  Object.assign(global, host.primitives || {});
  function evaluate(node, env = global) {
    if (--fuel < 0) throw new Error('Evaluation budget exceeded (possible recursive loop)');
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
    if (name === 'defn') {
      if (!isSym(args[0]) || args[1]?.type !== 'vector' || !args[1].items.every((n) => isSym(n)))
        throw new Error('Use (defn name [arguments] body...)');
      const params = args[1].items.map((n) => n.name),
        closure = env;
      env[args[0].name] = (...values) => {
        if (values.length !== params.length)
          throw new Error(`${args[0].name}: expected ${params.length} arguments`);
        // Prototype-linked environments implement lexical lookup, not mutation
        // of an outer binding. Shared mutation must go through set! explicitly.
        const local = Object.create(closure);
        params.forEach((p, i) => (local[p] = values[i]));
        let result;
        for (const n of args.slice(2)) result = evaluate(n, local);
        return result;
      };
      return null;
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
      if (args.length !== 2) throw new Error('set! expects a state key and value');
      const key = ev(args[0]);
      if (name === 'init!' && key in state) return state[key];
      const value = ev(args[1]);
      if (typeof key !== 'string') throw new Error('State keys must be keywords or strings');
      if (typeof value === 'number' && !Number.isFinite(value))
        throw new Error('State must be finite');
      if (!['number', 'string', 'boolean'].includes(typeof value))
        throw new Error('State values must be numbers, strings, or booleans');
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
    global,
    load(forms) {
      fuel = budget;
      for (const n of forms) evaluate(n);
    },
    call(name, ...args) {
      fuel = budget;
      if (typeof global[name] !== 'function') throw new Error(`Missing (defn ${name} [...])`);
      return global[name](...args);
    },
    evaluate(node) {
      fuel = budget;
      return evaluate(node);
    },
  };
}
