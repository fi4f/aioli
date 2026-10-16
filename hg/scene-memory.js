import { Types } from './types.js';
import { Data } from './data.js';
import { Modules } from './modules.js';

const __scenes__ = new WeakMap();
const __cells__ = new WeakMap();
const __references__ = new WeakMap();

function __reference__(reflection, name, cell) {
  const target = { reflection, name, cell, reference: Types.bindingHandle(name) };
  __references__.set(target.reference, target);
  reflection.bindings.set(name, target);
}

function __commit__(reflection, scene, previous) {
  const memory = __scenes__.get(scene);
  const bindings = new Map();
  for (const [name, cell] of memory?.bindings ?? []) {
    const target = previous.get(name) ?? {
      reflection,
      name,
      reference: Types.bindingHandle(name),
    };
    target.cell = cell;
    __references__.set(target.reference, target);
    bindings.set(name, target);
  }
  for (const [name, target] of reflection.bindings)
    if (bindings.get(name) !== target) {
      target.cell = null;
      __references__.delete(target.reference);
    }
  reflection.bindings = bindings;
  reflection.scene = scene;
  if (memory) memory.previousScene = undefined;
}

function __resolve__(reflection, reference) {
  const target = __references__.get(reference);
  if (!target) throw new TypeError('Binding reference is not registered or is no longer valid');
  if (target.reflection !== reflection)
    throw new TypeError('Binding reference belongs to a different app');
  if (!target.cell || reflection.bindings.get(target.name) !== target)
    throw new TypeError('Binding reference is no longer valid');
  return target;
}

// Candidate scenes have new cells; retained data keeps its original identity.
export const SceneMemory = {
  new(previous) {
    return {
      previous: __scenes__.get(previous)?.bindings,
      previousScene: previous,
      bindings: new Map(),
      imports: [],
    };
  },
  environment(scene) {
    const memory = __scenes__.get(scene);
    return {
      bindings: new Map(
        [...(memory?.bindings ?? [])].map(([name, cell]) => [
          name,
          { cell, ...__cells__.get(cell) },
        ]),
      ),
      imports: memory?.imports ?? [],
    };
  },
  sourceURL(scene) {
    return __scenes__.get(scene)?.sourceURL;
  },
  program(scene) {
    return __scenes__.get(scene)?.program;
  },
  execution(reflection, alive) {
    const scene = reflection.scene;
    const memory = __scenes__.get(scene);
    if (!scene || !memory)
      throw new TypeError('App.exec requires an active committed scene');
    return {
      scene,
      bindings: memory.bindings,
      imports: memory.imports,
      reflection,
      alive,
    };
  },
  assertActive(memory) {
    if (!memory.alive() || memory.reflection.scene !== memory.scene)
      throw new TypeError('The App.exec scene is no longer active');
  },
  importScope(memory, scope) {
    SceneMemory.assertActive(memory);
    memory.imports.unshift(scope);
  },
  mergeImport(memory, scope, namespace) {
    if (memory.reflection) SceneMemory.assertActive(memory);
    const checked = Modules.imports.scope(
      [...scope.reserved, ...memory.bindings.keys()],
      [scope, ...memory.imports],
    );
    Modules.imports.merge(checked, namespace);
    for (const [name, origin] of checked.entries) scope.entries.set(name, origin);
    return namespace;
  },
  retain(memory, name) {
    const cell = memory.previous?.get(name);
    return cell !== undefined && typeof cell.value !== 'function';
  },
  retainTyped(memory, name, type) {
    if (!SceneMemory.retain(memory, name)) return false;
    try {
      Types.assertType(SceneMemory.value(memory, name), type);
      return true;
    } catch (error) {
      if (error instanceof TypeError) return false;
      throw error;
    }
  },
  value(memory, name) {
    return memory.previous.get(name).value;
  },
  bind(memory, name, value, mutable, definition) {
    if (memory.reflection) {
      SceneMemory.assertActive(memory);
      if (memory.bindings.has(name) || memory.imports.some((scope) => scope.entries.has(name)))
        throw new SyntaxError(`Name already defined: ${name}`);
    }
    const cell = { value };
    __cells__.set(cell, { mutable, definition });
    memory.bindings.set(name, cell);
    if (memory.reflection) __reference__(memory.reflection, name, cell);
    return cell;
  },
  finish(memory, scene, imported) {
    if (imported) memory.imports.push(imported);
    __scenes__.set(scene, {
      bindings: memory.bindings,
      imports: memory.imports,
      sourceURL: memory.sourceURL,
      program: memory.program,
      previousScene: memory.previousScene,
    });
    memory.previous = undefined;
    memory.previousScene = undefined;
    return scene;
  },
  reflection() {
    return { scene: null, bindings: new Map() };
  },
  load(reflection, scene) {
    __commit__(reflection, scene, new Map());
  },
  patch(reflection, scene) {
    __commit__(
      reflection,
      scene,
      __scenes__.get(scene)?.previousScene === reflection.scene ? reflection.bindings : new Map(),
    );
  },
  clear(reflection) {
    SceneMemory.load(reflection, null);
  },
  inspect(reflection) {
    const result = Data.dict();
    for (const [name, target] of reflection.bindings) Data.put(result, name, target.reference);
    return result;
  },
  read(reflection, reference) {
    return Data.normalizeNil(__resolve__(reflection, reference).cell.value);
  },
  call(reflection, reference, args) {
    const fn = SceneMemory.read(reflection, reference);
    if (typeof fn !== 'function') throw new TypeError('App.call expects a callable binding');
    if (Data.dataKind(args) !== 'list') throw new TypeError('App.call expects an argument list');
    const values = Array.from(Data.values(args), Data.languageValue);
    return Data.normalizeNil(fn(...values));
  },
  write(reflection, reference, value) {
    const target = __resolve__(reflection, reference);
    if (!__cells__.get(target.cell)?.mutable)
      throw new TypeError(`Cannot reassign binding: ${target.name}`);
    const replacement = Data.languageValue(value);
    target.cell.value = replacement;
    return replacement;
  },
};
