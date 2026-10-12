import { Structures } from './structures.js';
import { NumericTypes } from './numeric-types.js';
// Only typed values require registration. Lists and dictionaries are native JS data.
const __kinds__ = new WeakMap();
const __lazyLists__ = new WeakMap();
const __bindingCells__ = new WeakMap();
const __componentNames__ = ['x', 'y', 'z', 'w'];
function __registerData__(value, kind) {
  __kinds__.set(value, kind);
  return value;
}
const __opaque__ = new WeakSet();
// Registered host records retain identity and use ordinary stored fields.
const __hostData__ = new WeakSet();
const __isHostData__ = (value) =>
  value !== null && typeof value === 'object' && __hostData__.has(value);
function __registerHostData__(value) {
  __hostData__.add(value);
  return __registerOpaque__(value);
}
const __textureSizes__ = new WeakMap();
function __registerTextureSize__(handle, width, height) {
  __textureSizes__.set(handle, [width, height]);
}
const __normalizeNil__ = (value) => {
  if (typeof value === 'number') NumericTypes.assertFinite(value);
  if (value instanceof Promise) __opaque__.add(value);
  return value === undefined ? null : value;
};
function __bool__(value) {
  if (arguments.length > 1) throw new TypeError('bool expects at most one value');
  if (arguments.length === 0) return false;
  if (typeof value === 'number') NumericTypes.assertFinite(value, 'bool');
  if (value === null || value === undefined || value === false || value === '' || value === 0)
    return false;
  const kind = __dataKind__(value);
  if (kind === 'many') return Structures.collectionInfo(value).length !== 0;
  if (kind === 'list') return value.length !== 0;
  if (kind === 'dict') return Object.keys(__values__(value)).length !== 0;
  return true;
}
function __str__(value) {
  if (arguments.length > 1) throw new TypeError('str expects at most one value');
  if (arguments.length === 0) return '';
  value = __normalizeNil__(value);
  if (value === null) return 'nil';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    NumericTypes.assertFinite(value, 'str');
    return Object.is(value, -0) ? '-0' : String(value);
  }
  throw new TypeError('str expects nil, num, bool, or str; use to-json for collections');
}
function __registerOpaque__(value) {
  __opaque__.add(value);
  return value;
}
function __dataKind__(value) {
  if (value === null || typeof value !== 'object') return undefined;
  const kind = __kinds__.get(value);
  if (kind) return kind;
  if (__opaque__.has(value)) return undefined;
  if (Array.isArray(value)) return 'list';
  const prototype = Object.getPrototypeOf(value);
  // Accept object literals (including other realms) and null-prototype records.
  // Native resources and class instances retain their separate boundary contracts.
  if (prototype === null || Object.getPrototypeOf(prototype) === null) return 'dict';
  return undefined;
}

function __registerBindingCells__(namespace, cells) {
  __bindingCells__.set(namespace, cells);
  return namespace;
}

function __languageValue__(value) {
  value = __normalizeNil__(value);
  if (
    value === null ||
    ['undefined', 'number', 'string', 'boolean', 'function'].includes(typeof value) ||
    __dataKind__(value) ||
    __opaque__.has(value)
  )
    return value;
  throw new TypeError('Collections require primitives or language values');
}

function __tagged__(type, values) {
  // Registration records the language kind; wrappers and storage are mutable.
  if (NumericTypes.vectorInfo(type) || /^mat([234])x\1f$/.test(type)) {
    return __numericFromComponents__(type, values);
  }
  const result = { type, values };
  __kinds__.set(result, type);
  return result;
}

const __list__ = (...values) => values.map(__languageValue__);
// Deferred snapshots are ordinary sparse arrays. Only explicit reads build entries.
function __lazyList__(length, build) {
  const value = new Array(length);
  __lazyLists__.set(value, { build, length });
  return value;
}
function __values__(value) {
  const kind = __dataKind__(value);
  const cells = __bindingCells__.get(value);
  if (cells) return Object.fromEntries(Object.keys(cells).map((key) => [key, __get__(value, key)]));
  if (kind === 'dict' || kind === 'error') return value;
  if (kind === 'list') {
    if (__lazyLists__.has(value)) {
      for (let i = 0; i < value.length; i++) __listGet__(value, i);
      __lazyLists__.delete(value);
    }
    return value;
  }
  if (value.__numericView__) return Structures.numericValues(value);
  if (value.__column__) {
    const { matrix, column, size } = value.__column__;
    return __values__(matrix).slice(column * size, (column + 1) * size);
  }
  const vector = NumericTypes.vectorInfo(kind);
  if (vector) return __componentNames__.slice(0, vector.size).map((key) => value[key]);
  if (value.__struct__)
    return Object.fromEntries(
      value.__struct__.definition.fields.map((field) => [
        field.key,
        Structures.structuredGet(value, field.key),
      ]),
    );
  return value.values;
}
function __listGet__(value, key) {
  const lazy = __lazyLists__.get(value);
  if (lazy && key < lazy.length && !Object.hasOwn(value, key)) {
    value[key] = __languageValue__(lazy.build(key));
  }
  return value[key];
}
function __component__(value, index) {
  return __get__(value, index);
}
function __dict__(...entries) {
  if (entries.length === 1) {
    const input = entries[0];
    if (input === null || input === undefined) return {};
    const kind = __dataKind__(input);
    if (kind === 'dict') return input;
    if (kind === 'list') entries = input;
  }
  const values = {};
  for (let i = 0; i < entries.length; i += 2) {
    const key = __listGet__(entries, i);
    if (typeof key !== 'string') throw new TypeError('dict keys must be strings');
    __putOwn__(values, key, __languageValue__(__listGet__(entries, i + 1)));
  }
  return values;
}

function __putOwn__(target, key, value) {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

function __vector__(size, values, type = `vec${size}f`) {
  const info = NumericTypes.vectorInfo(type);
  const input = values[0];
  if (!values.length || (values.length === 1 && (input === null || input === undefined)))
    return __tagged__(type, Array(size).fill(0));
  if (values.length === 1 && typeof input === 'number')
    return __tagged__(type, Array(size).fill(NumericTypes.convertComponent(input, info.scalar)));
  const components = [];
  const visiting = new WeakSet();
  const append = (value) => {
    if (components.length === size) return;
    if (typeof value === 'number') {
      components.push(value);
      return;
    }
    const kind = __dataKind__(value);
    const vector = NumericTypes.vectorInfo(kind);
    if (vector) {
      for (let index = 0; index < vector.size && components.length < size; index++)
        components.push(__component__(value, index));
      return;
    }
    if (kind === 'list') {
      if (visiting.has(value)) throw new TypeError(`${type}: cyclic list input`);
      visiting.add(value);
      try {
        for (let index = 0; index < value.length && components.length < size; index++)
          append(__listGet__(value, index));
      } finally {
        visiting.delete(value);
      }
      return;
    }
    throw new TypeError(`${type}: expected numeric scalars, lists, or vectors`);
  };
  for (const value of values) {
    if (components.length === size) break;
    append(value);
  }
  while (components.length < size) components.push(0);
  return __tagged__(
    type,
    components.map((value) => NumericTypes.convertComponent(value, info.scalar)),
  );
}

function __vectorRecord__(type, components) {
  const { size } = NumericTypes.vectorInfo(type);
  return {
    __type__: type,
    ...Object.fromEntries(__componentNames__.slice(0, size).map((key, i) => [key, components[i]])),
  };
}
// Internal numeric constructor. Arithmetic and swizzles supply component arrays
// explicitly; vectors store named fields, matrices retain their component storage.
function __numericFromComponents__(type, components) {
  components.forEach((value) => NumericTypes.assertFinite(value, `${type} component`));
  const vector = NumericTypes.vectorInfo(type);
  if (vector) return __registerData__(__vectorRecord__(type, components), type);
  return __registerData__({ type, values: components }, type);
}

function __matrix__(size, values) {
  if (!values.length) return __tagged__(`mat${size}x${size}f`, Array(size * size).fill(0));
  if (
    values.length === size &&
    values.every(
      (value) =>
        NumericTypes.vectorInfo(__dataKind__(value))?.size === size &&
        ['f32'].includes(NumericTypes.vectorInfo(__dataKind__(value)).scalar),
    )
  ) {
    return __tagged__(
      `mat${size}x${size}f`,
      values.flatMap((value) =>
        Array.from(__values__(value), (component) =>
          NumericTypes.convertComponent(component, 'f32'),
        ),
      ),
    );
  }
  if (values.length === size * size && values.every((value) => typeof value === 'number')) {
    return __tagged__(
      `mat${size}x${size}f`,
      values.map((value) => NumericTypes.convertComponent(value, 'f32')),
    );
  }
  throw new TypeError(
    `mat${size}x${size}f: expected no arguments, ${size} float-vector columns, or ${size * size} scalars`,
  );
}

function __matrixColumn__(value, column) {
  const kind = __dataKind__(value),
    size = NumericTypes.matrixSize(kind);
  if (!/^mat([234])x\1f$/.test(kind || '')) throw new TypeError('Expected a matrix');
  __index__(column, size);
  value.__columns__ ??= [];
  return (value.__columns__[column] ??= __registerData__(
    { __type__: `vec${size}f`, __column__: { matrix: value, column, size } },
    `vec${size}f`,
  ));
}

function __copy__(value) {
  value = __normalizeNil__(value);
  const kind = __dataKind__(value);
  if (kind === 'struct' || kind === 'array' || kind === 'many')
    return Structures.structuredCopy(value);
  if (!kind) return value; // Primitive values, functions, and opaque handles retain identity.
  if (kind === 'dict') return Object.fromEntries(Object.entries(__values__(value)));
  if (kind === 'error') return __registerData__({ ...value }, 'error');
  if (kind === 'list') return [...__values__(value)];
  return __tagged__(kind, [...__values__(value)]);
}
function __reCopy__(value, seen = new Map()) {
  value = __normalizeNil__(value);
  if (!__dataKind__(value)) return value;
  if (seen.has(value)) return seen.get(value);
  const result = __copy__(value);
  seen.set(value, result);
  if (Structures.structInfo(value) || Structures.collectionInfo(value)) return result;
  if (NumericTypes.vectorInfo(__dataKind__(value)) || NumericTypes.matrixSize(__dataKind__(value)))
    return result;
  const values = __values__(result);
  for (const key of Object.keys(values)) __putOwn__(values, key, __reCopy__(values[key], seen));
  return result;
}

function __collection__(value) {
  const kind = __dataKind__(value);
  if (!kind || kind === 'error') throw new TypeError('Expected a list, dict, vector, or matrix');
  return kind;
}
function __index__(key, size) {
  if (!Number.isInteger(key) || key < 0 || key >= size)
    throw new RangeError('Index must be an integer within bounds');
}
function __get__(value, key) {
  const cells = __bindingCells__.get(value);
  if (cells) {
    if (typeof key !== 'string') throw new TypeError('Module keys must be strings');
    return Object.hasOwn(cells, key) ? __normalizeNil__(cells[key].value) : null;
  }
  const kind = __dataKind__(value);
  if (kind === 'list') {
    __index__(key, value.length);
    return __normalizeNil__(__listGet__(value, key));
  }
  if (kind === 'dict' || kind === 'error') {
    if (typeof key !== 'string') throw new TypeError(`${kind} keys must be strings`);
    return Object.hasOwn(value, key) ? __normalizeNil__(value[key]) : null;
  }
  if (value?.__numericView__) {
    __index__(key, value.__numericView__.length);
    return Structures.numericValues(value)[key];
  }
  if (value?.__column__) {
    const view = value.__column__;
    __index__(key, view.size);
    return __get__(view.matrix, view.column * view.size + key);
  }
  const vector = NumericTypes.vectorInfo(kind);
  if (vector) {
    __index__(key, vector.size);
    return __normalizeNil__(value[__componentNames__[key]]);
  }
  if (__isHostData__(value)) {
    if (typeof key !== 'string') throw new TypeError('Record keys must be strings');
    return Object.hasOwn(value, key) ? __normalizeNil__(value[key]) : null;
  }
  if (__textureSizes__.has(value)) {
    const [width, height] = __textureSizes__.get(value);
    if (key === '__type__') return '__texture2d__';
    if (key === 'w') return width;
    if (key === 'h') return height;
    if (key === 'wh') return __vector__(2, [width, height]);
    throw new TypeError(`Unknown texture field: ${key}`);
  }
  if (
    Structures.structDefinitionInfo(value) ||
    Structures.structInfo(value) ||
    Structures.collectionInfo(value)
  )
    return Structures.structuredGet(value, key);
  __collection__(value);
  __index__(key, value.values.length);
  return __normalizeNil__(value.values[key]);
}
function __put__(value, key, replacement) {
  const cells = __bindingCells__.get(value);
  if (cells) {
    if (typeof key !== 'string') throw new TypeError('Module keys must be strings');
    if (!Object.hasOwn(cells, key)) __putOwn__(cells, key, { value: null });
    cells[key].value = __languageValue__(replacement);
    return value;
  }
  const kind = __dataKind__(value);
  if (kind === 'list') {
    __index__(key, value.length);
    __putOwn__(value, key, __languageValue__(replacement));
    return value;
  }
  if (kind === 'dict') {
    if (typeof key !== 'string') throw new TypeError('dict keys must be strings');
    __putOwn__(value, key, __languageValue__(replacement));
    return value;
  }
  if (kind === 'error') {
    if (!['name', 'message'].includes(key))
      throw new TypeError('Writable error fields are name and message');
    if (typeof replacement !== 'string') throw new TypeError('Error fields must be strings');
    value[key] = replacement;
    return value;
  }
  if (value?.__numericView__) {
    Structures.numericPut(value, key, replacement);
    return value;
  }
  if (value?.__column__) {
    const view = value.__column__;
    __index__(key, view.size);
    __put__(view.matrix, view.column * view.size + key, replacement);
    return value;
  }
  if (__isHostData__(value)) {
    if (typeof key !== 'string') throw new TypeError('Record keys must be strings');
    __putOwn__(value, key, __languageValue__(replacement));
    return value;
  }
  if (
    Structures.structDefinitionInfo(value) ||
    Structures.structInfo(value) ||
    Structures.collectionInfo(value)
  )
    return Structures.structuredPut(value, key, replacement);
  replacement = __languageValue__(replacement);
  __collection__(value);
  const info = NumericTypes.vectorInfo(kind);
  __index__(key, info ? info.size : value.values.length);
  if (typeof replacement !== 'number')
    throw new TypeError('Vector and matrix components must be numbers');
  if (info?.suffix) {
    if (!NumericTypes.scalarMatches(replacement, info.scalar === 'f32' ? 'num' : info.scalar))
      throw new TypeError(`Expected ${info.scalar} component; use an explicit conversion`);
  }
  const component =
    info?.scalar === 'f32' || /^mat([234])x\1f$/.test(kind)
      ? Math.fround(replacement)
      : replacement;
  NumericTypes.assertFinite(component, `${kind} component`);
  if (info) value[__componentNames__[key]] = component;
  else value.values[key] = component;
  return value;
}
function __insert__(target, value, at) {
  if (arguments.length < 2 || arguments.length > 3)
    throw new TypeError('insert expects a list or many, value, and optional index');
  if (__dataKind__(target) === 'many')
    return Structures.manyInsert(target, value, arguments.length === 2 ? undefined : at);
  if (__dataKind__(target) !== 'list')
    throw new TypeError('insert expects a list or many as its first argument');
  if (arguments.length === 2) at = __values__(target).length;
  __index__(at, __values__(target).length + 1);
  value = __languageValue__(value);
  __values__(target).splice(at, 0, value);
  return target;
}
function __remove__(target, at) {
  if (arguments.length !== 2) throw new TypeError('remove expects a list or many and index');
  if (__dataKind__(target) === 'many') return Structures.manyRemove(target, at);
  if (__dataKind__(target) !== 'list')
    throw new TypeError('remove expects a list or many as its first argument');
  if (at === null) return target;
  __index__(at, __values__(target).length);
  __values__(target).splice(at, 1);
  return target;
}
function __same__(left, right) {
  if (arguments.length !== 2) throw new TypeError('same? expects exactly two values');
  if (typeof left === 'number') NumericTypes.assertFinite(left, 'same? operand');
  if (typeof right === 'number') NumericTypes.assertFinite(right, 'same? operand');
  return Object.is(__normalizeNil__(left), __normalizeNil__(right));
}

function __equal__(left, right, seen) {
  if (typeof left === 'number') NumericTypes.assertFinite(left, '= operand');
  if (typeof right === 'number') NumericTypes.assertFinite(right, '= operand');
  if (Object.is(left, right)) return true;
  const kind = __dataKind__(left);
  if (!kind || kind !== __dataKind__(right)) return false;
  if (
    kind === 'struct' &&
    Structures.structInfo(left).definition !== Structures.structInfo(right).definition
  )
    return false;
  if (kind === 'array' || kind === 'many') {
    const a = Structures.collectionInfo(left),
      b = Structures.collectionInfo(right);
    return (
      Structures.sameElement(a.element, b.element) &&
      a.length === b.length &&
      Array.from({ length: a.length }, (_, i) =>
        __equal__(__get__(left, i), __get__(right, i), seen),
      ).every(Boolean)
    );
  }
  seen ??= new Map();
  if (seen.get(left)?.has(right)) return true;
  if (!seen.has(left)) seen.set(left, new Set());
  seen.get(left).add(right);
  if (kind === 'dict' || kind === 'error' || kind === 'struct') {
    const keys = Object.keys(__values__(left));
    return (
      keys.length === Object.keys(__values__(right)).length &&
      keys.every(
        (key) =>
          Object.hasOwn(__values__(right), key) &&
          __equal__(__values__(left)[key], __values__(right)[key], seen),
      )
    );
  }
  return (
    __values__(left).length === __values__(right).length &&
    __values__(left).every((value, i) => __equal__(value, __values__(right)[i], seen))
  );
}

function __contains__(value, target) {
  if (arguments.length !== 2)
    throw new TypeError('in expects a value or key followed by a list, dict, or many');
  const kind = __dataKind__(target);
  if (kind === 'many') {
    for (let i = 0; i < Structures.collectionInfo(target).length; i++)
      if (__equal__(__get__(target, i), __normalizeNil__(value))) return true;
    return false;
  }
  if (kind === 'list')
    return __values__(target).some((item) => __equal__(item, __normalizeNil__(value)));
  if (kind === 'dict') {
    if (typeof value !== 'string') throw new TypeError('in: dict keys must be strings');
    return Object.hasOwn(__values__(target), value);
  }
  throw new TypeError('in expects a list, dict, or many as its second argument');
}

function __where__(target, value) {
  if (arguments.length !== 2)
    throw new TypeError('where expects a list, dict, or many followed by a value');
  value = __normalizeNil__(value);
  const kind = __dataKind__(target);
  if (kind === 'many') {
    for (let i = 0; i < Structures.collectionInfo(target).length; i++)
      if (__equal__(__get__(target, i), value)) return i;
    return null;
  }
  if (kind === 'list') {
    const found = __values__(target).findIndex((item) => __equal__(__normalizeNil__(item), value));
    return found === -1 ? null : found;
  }
  if (kind === 'dict') {
    for (const [key, item] of Object.entries(__values__(target))) {
      if (__equal__(__normalizeNil__(item), value)) return key;
    }
    return null;
  }
  throw new TypeError('where expects a list, dict, or many as its first argument');
}

function __jsonValues__(value) {
  const kind = __dataKind__(value);
  if (kind === 'array' || kind === 'many')
    return Array.from({ length: Structures.collectionInfo(value).length }, (_, i) =>
      __get__(value, i),
    );
  return __values__(value);
}
function __serializeData__(value) {
  const active = new Set();
  function validate(value) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (!__dataKind__(value))
      throw new TypeError('Value cannot be serialized losslessly as JSON data');
    if (active.has(value)) throw new TypeError('Cyclic data cannot be serialized as JSON');
    active.add(value);
    const values = __jsonValues__(value);
    // Visit sparse entries too: JSON would silently change holes to null.
    (Array.isArray(values) ? Array.from(values) : Object.values(values)).forEach(validate);
    active.delete(value);
  }
  validate(value);
  function encode(item) {
    const kind = __dataKind__(item);
    if (!kind) return item;
    const values = __jsonValues__(item);
    if (kind === 'list' || kind === 'array' || kind === 'many') return values.map(encode);
    if (kind === 'dict' || kind === 'error' || kind === 'struct')
      return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, encode(value)]));
    const vector = NumericTypes.vectorInfo(kind);
    if (vector) return __vectorRecord__(kind, values);
    return {
      type: kind,
      values: values.map(encode),
    };
  }
  return JSON.stringify(encode(value));
}
function __deserializeData__(text) {
  if (typeof text !== 'string') throw new TypeError('from-json expects a string');
  return JSON.parse(text, (_key, value) =>
    typeof value === 'number' ? NumericTypes.assertFinite(value, 'JSON number') : value,
  );
}

function __cap__(value) {
  if (arguments.length !== 1)
    throw new TypeError('cap expects exactly one list, dict, array, or many');
  const kind = __dataKind__(value);
  if (kind === 'array' || kind === 'many') return Structures.collectionInfo(value).capacity;
  if (kind === 'list') return value.length;
  if (kind === 'dict') return Object.keys(__values__(value)).length;
  throw new TypeError('cap expects a list, dict, array, or many');
}

function __len__(value) {
  if (typeof value === 'string') return value.length;
  const kind = __dataKind__(value);
  if (kind === 'list') return value.length;
  if (kind === 'dict') return Object.keys(__values__(value)).length;
  if (
    Structures.structDefinitionInfo(value) ||
    kind === 'struct' ||
    kind === 'array' ||
    kind === 'many'
  )
    return Structures.structuredLen(value);
  __collection__(value);
  if (value.__column__) return value.__column__.size;
  if (value.__numericView__) return value.__numericView__.length;
  const vector = NumericTypes.vectorInfo(kind);
  if (vector) return vector.size;
  return value.values.length;
}

function __keys__(value) {
  if (arguments.length !== 1 || __dataKind__(value) !== 'dict')
    throw new TypeError('keys expects one dictionary');
  return Object.keys(__values__(value));
}

const __dataBindings__ = {
  list: __list__,
  dict: __dict__,
  put: __put__,
  insert: __insert__,
  remove: __remove__,
  where: __where__,
  copy: __copy__,
  bool: __bool__,
  in: __contains__,
  're-copy': (value) => __reCopy__(value),
  '=': (left, right) => __equal__(left, right),
  'same?': __same__,
  cap: __cap__,
  len: __len__,
  keys: __keys__,
  'to-json': __serializeData__,
  'from-json': __deserializeData__,
};

export const Data = {
  registerData: __registerData__,
  registerBindingCells: __registerBindingCells__,
  bindingCells: (namespace) => __bindingCells__.get(namespace),
  isHostData: __isHostData__,
  registerHostData: __registerHostData__,
  registerTextureSize: __registerTextureSize__,
  normalizeNil: __normalizeNil__,
  languageValue: __languageValue__,
  bool: __bool__,
  str: __str__,
  registerOpaque: __registerOpaque__,
  dataKind: __dataKind__,
  list: __list__,
  lazyList: __lazyList__,
  values: __values__,
  component: __component__,
  dict: __dict__,
  vector: __vector__,
  numericFromComponents: __numericFromComponents__,
  matrix: __matrix__,
  matrixColumn: __matrixColumn__,
  copy: __copy__,
  reCopy: __reCopy__,
  get: __get__,
  put: __put__,
  insert: __insert__,
  remove: __remove__,
  equal: __equal__,
  same: __same__,
  contains: __contains__,
  where: __where__,
  serializeData: __serializeData__,
  deserializeData: __deserializeData__,
  cap: __cap__,
  len: __len__,
  keys: __keys__,
  dataBindings: __dataBindings__,
};
