import { Data } from './data.js';
import { Promises } from './promises.js';

// Compiled lexical bindings and imported names share ordinary value cells.
function __moduleNamespace__(bindings, callbacks = {}, imported) {
  const namespace = Object.fromEntries(bindings);
  for (const [name, origin] of imported?.entries ?? [])
    Data.put(namespace, name, Data.bindingCells(origin)[name]);
  for (const [name, value] of Object.entries(callbacks))
    if (!Object.hasOwn(namespace, name)) Data.put(namespace, name, { value });
  return Data.registerBindingCells(namespace, namespace);
}
const __importRuntime__ = {
  scope(reserved, parents) {
    return { reserved: new Set(reserved), parents, entries: new Map() };
  },
  merge(scope, namespace) {
    if (Data.dataKind(namespace) !== 'dict')
      throw new TypeError('Import must resolve to a module namespace');
    const cells = Data.bindingCells(namespace);
    const members = Object.keys(cells ?? namespace);
    for (const name of members) {
      const origins = [scope, ...scope.parents]
        .map((parent) => parent.entries.get(name))
        .filter(Boolean);
      if (scope.reserved.has(name) || origins.some((origin) => origin !== namespace))
        throw new SyntaxError(`Import name conflict: ${name}`);
    }
    if (!cells) {
      const entries = members.map((name) => [name, { value: Data.get(namespace, name) }]);
      for (const [name, cell] of entries) Data.put(namespace, name, cell);
      Data.registerBindingCells(namespace, namespace);
    }
    for (const name of members) {
      scope.entries.set(name, namespace);
    }
    return namespace;
  },
  cell(scopes, name) {
    for (const scope of scopes) {
      const origin = scope.entries.get(name);
      if (origin) return Data.bindingCells(origin)[name];
    }
    throw new ReferenceError(`Unknown symbol: ${name}`);
  },
};

function __moduleData__({
  baseURL,
  compile,
  execute,
  fetch: fetchSource = (...args) => globalThis.fetch(...args),
  alive = () => true,
}) {
  const loader = {};
  loader.baseURL = baseURL;
  loader.compile = compile;
  loader.execute = execute;
  loader.fetch = fetchSource;
  loader.alive = alive;
  loader.cache = new Map();
  return loader;
}

export const Modules = {
  resolve(loader, path, parent = loader.baseURL) {
    if (typeof path !== 'string' || !path.length)
      throw new TypeError('Module path must be a nonempty string');
    const url = new URL(path, parent);
    url.hash = '';
    return url.href;
  },

  checkAlive(loader) {
    if (!loader.alive()) throw new Error('Mercury app has been disposed.');
  },

  async read(loader, url) {
    Modules.checkAlive(loader);
    const response = await loader.fetch(url);
    if (!response.ok) throw new Error(`Unable to load ${url}: HTTP ${response.status}`);
    const source = await response.text();
    Modules.checkAlive(loader);
    return source;
  },

  import(loader, path, parent = loader.baseURL) {
    // Always reject through a promise, including malformed paths and cycles.
    return Promises.registerPromise(
      Promise.resolve().then(async () => {
        Modules.checkAlive(loader);
        const url = Modules.resolve(loader, path, parent);
        const importer = loader.cache.get(parent);
        let entry = loader.cache.get(url);
        if (!entry) {
          entry = { pending: true, dependencies: new Map() };
          loader.cache.set(url, entry);
          entry.promise = Promises.registerPromise(
            Promise.resolve()
              .then(async () => {
                const source = await Modules.read(loader, url);
                const program = loader.compile(source, { sourceURL: url });
                const namespace = await loader.execute(program);
                Modules.checkAlive(loader);
                return namespace;
              })
              .then(
                (value) => {
                  entry.pending = false;
                  return value;
                },
                (error) => {
                  if (error instanceof Error && error.lisp && !error.lisp.sourceURL)
                    error.lisp.sourceURL = url;
                  entry.pending = false;
                  if (loader.cache.get(url) === entry) loader.cache.delete(url);
                  throw error;
                },
              ),
          );
        }
        if (!importer?.pending || !entry.pending) return entry.promise;
        const chain = Modules.dependencyPath(loader, url, parent);
        if (chain) throw new Error(`Circular import: ${[parent, ...chain].join(' -> ')}`);
        importer.dependencies.set(url, (importer.dependencies.get(url) ?? 0) + 1);
        try {
          return await entry.promise;
        } finally {
          const count = importer.dependencies.get(url) - 1;
          if (count) importer.dependencies.set(url, count);
          else importer.dependencies.delete(url);
        }
      }),
    );
  },

  dependencyPath(loader, from, target, visited = new Set()) {
    if (from === target) return [from];
    if (visited.has(from)) return null;
    visited.add(from);
    const entry = loader.cache.get(from);
    if (!entry?.pending) return null;
    for (const next of entry.dependencies.keys()) {
      const path = Modules.dependencyPath(loader, next, target, visited);
      if (path) return [from, ...path];
    }
    return null;
  },
  namespace: __moduleNamespace__,
  imports: __importRuntime__,
  new: __moduleData__,
};
