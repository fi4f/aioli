import { Types } from './types.js';
import { Data } from './data.js';
import { Modules } from './modules.js';

const __bindings__ = new WeakMap();
const __previous__ = new WeakMap();
const __mutable__ = new WeakMap();
const __definitions__ = new WeakMap();
const __imports__ = new WeakMap();
const __sourceURLs__ = new WeakMap();
const __programs__ = new WeakMap();
const __references__ = new WeakMap();

function __reference__(reflection, name, cell) {
  const target = { reflection, name, cell, reference: Types.bindingHandle(name) };
  __references__.set(target.reference, target);
  reflection.bindings.set(name, target);
}

function __commit__(reflection, scene, previous) {
  const bindings = new Map();
  for (const [name, cell] of __bindings__.get(scene) ?? []) {
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
  __previous__.delete(scene);
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
      previous: __bindings__.get(previous),
      previousScene: previous,
      bindings: new Map(),
      imports: [],
    };
  },
  environment(scene) {
    return {
      bindings: new Map(
        [...(__bindings__.get(scene) ?? [])].map(([name, cell]) => [
          name,
          { cell, mutable: __mutable__.get(cell), definition: __definitions__.get(cell) },
        ]),
      ),
      imports: __imports__.get(scene) ?? [],
    };
  },
  sourceURL(scene) {
    return __sourceURLs__.get(scene);
  },
  program(scene) {
    return __programs__.get(scene);
  },
  execution(reflection, alive) {
    const scene = reflection.scene;
    if (!scene || !__bindings__.has(scene))
      throw new TypeError('App.exec requires an active committed scene');
    return {
      scene,
      bindings: __bindings__.get(scene),
      imports: __imports__.get(scene),
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
    __mutable__.set(cell, mutable);
    if (definition) __definitions__.set(cell, definition);
    memory.bindings.set(name, cell);
    if (memory.reflection) __reference__(memory.reflection, name, cell);
    return cell;
  },
  finish(memory, scene, imported) {
    __bindings__.set(scene, memory.bindings);
    if (imported) memory.imports.push(imported);
    __imports__.set(scene, memory.imports);
    __sourceURLs__.set(scene, memory.sourceURL);
    __programs__.set(scene, memory.program);
    __previous__.set(scene, memory.previousScene);
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
      __previous__.get(scene) === reflection.scene ? reflection.bindings : new Map(),
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
    if (!__mutable__.get(target.cell))
      throw new TypeError(`Cannot reassign binding: ${target.name}`);
    const replacement = Data.languageValue(value);
    target.cell.value = replacement;
    return replacement;
  },
};
