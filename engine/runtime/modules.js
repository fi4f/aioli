import { dataKind, dict, put } from '../language/data.js';
import { registerPromise } from '../language/promises.js';

// Accessors keep namespace assignments and lexical references on the same cells.
export function moduleNamespace(bindings, callbacks = {}, imported) {
  const namespace = dict();
  for (const [name, get, set] of bindings) {
    Object.defineProperty(namespace.values, name, { enumerable: true, configurable: true, get, set });
  }
  for (const [name, origin] of imported?.entries ?? []) {
    Object.defineProperty(namespace.values, name, { enumerable: true, configurable: true,
      get: () => origin.values[name], set: value => { put(origin, name, value); } });
  }
  for (const name of Object.keys(callbacks)) {
    if (Object.hasOwn(namespace.values, name)) continue;
    Object.defineProperty(namespace.values, name, { enumerable: true, configurable: true,
      get: () => callbacks[name], set: value => { callbacks[name] = value; } });
  }
  return namespace;
}

export const importRuntime = {
  scope(reserved, parents) { return { reserved: new Set(reserved), parents, entries: new Map() }; },
  merge(scope, namespace) {
    if (dataKind(namespace) !== 'dict') throw new TypeError('Import must resolve to a module namespace');
    const members = Object.keys(namespace.values);
    // Validate the whole merge before publishing any members.
    for (const name of members) {
      const origins = [scope, ...scope.parents].map(parent => parent.entries.get(name)).filter(Boolean);
      if (scope.reserved.has(name) || origins.some(origin => origin !== namespace)) {
        throw new SyntaxError(`Import name conflict: ${name}`);
      }
    }
    for (const name of members) scope.entries.set(name, namespace);
    return namespace;
  },
  cell(scopes, name) {
    for (const scope of scopes) {
      const origin = scope.entries.get(name);
      if (origin) return { get value() { return origin.values[name]; }, set value(value) { put(origin, name, value); } };
    }
    throw new ReferenceError(`Unknown symbol: ${name}`);
  },
};

export class ModuleLoader {
  constructor({ baseURL, compile, fetch: fetchSource = (...args) => globalThis.fetch(...args),
    alive = () => true }) {
    this.baseURL = baseURL;
    this.compile = compile;
    this.fetch = fetchSource;
    this.alive = alive;
    this.cache = new Map();
  }

  resolve(path, parent = this.baseURL) {
    if (typeof path !== 'string' || !path.length) throw new TypeError('Module path must be a nonempty string');
    const url = new URL(path, parent);
    url.hash = '';
    return url.href;
  }

  checkAlive() {
    if (!this.alive()) throw new Error('Aioli runtime has been destroyed.');
  }

  async read(url) {
    this.checkAlive();
    const response = await this.fetch(url);
    if (!response.ok) throw new Error(`Unable to load ${url}: HTTP ${response.status}`);
    const source = await response.text();
    this.checkAlive();
    return source;
  }

  import(path, parent = this.baseURL) {
    // Always reject through a promise, including malformed paths and cycles.
    return registerPromise(Promise.resolve().then(async () => {
      this.checkAlive();
      const url = this.resolve(path, parent);
      const importer = this.cache.get(parent);
      let entry = this.cache.get(url);
      if (!entry) {
        entry = { pending: true, dependencies: new Map() };
        this.cache.set(url, entry);
        entry.promise = registerPromise(Promise.resolve().then(async () => {
          const source = await this.read(url);
          const program = this.compile(source, { module: true, sourceURL: url });
          const namespace = await program.run();
          this.checkAlive();
          return namespace;
        }).then(value => {
          entry.pending = false;
          return value;
        }, error => {
          if (error instanceof Error && error.lisp && !error.lisp.sourceURL) error.lisp.sourceURL = url;
          entry.pending = false;
          if (this.cache.get(url) === entry) this.cache.delete(url);
          throw error;
        }));
      }
      if (!importer?.pending || !entry.pending) return entry.promise;
      const chain = this.dependencyPath(url, parent);
      if (chain) throw new Error(`Circular import: ${[parent, ...chain].join(' -> ')}`);
      importer.dependencies.set(url, (importer.dependencies.get(url) ?? 0) + 1);
      try { return await entry.promise; }
      finally {
        const count = importer.dependencies.get(url) - 1;
        if (count) importer.dependencies.set(url, count);
        else importer.dependencies.delete(url);
      }
    }));
  }

  dependencyPath(from, target, visited = new Set()) {
    if (from === target) return [from];
    if (visited.has(from)) return null;
    visited.add(from);
    const entry = this.cache.get(from);
    if (!entry?.pending) return null;
    for (const next of entry.dependencies.keys()) {
      const path = this.dependencyPath(next, target, visited);
      if (path) return [from, ...path];
    }
    return null;
  }
}
