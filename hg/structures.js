import { Data } from './data.js';
import { NumericTypes } from './numeric-types.js';

const __structField__ = (definition, key) => definition.fields.find((field) => field.key === key);
function __markCheckedView__(value) {
  value.__checked__ = true;
  return value;
}
const __isCheckedView__ = (value) =>
  Boolean(value?.__checked__ || value?.__column__?.matrix.__checked__);
const __structDefinitionInfo__ = (value) =>
  typeof value === 'function' ? value.__definition__ : undefined;
const __structInfo__ = (value) =>
  Data.dataKind(value) === 'struct' ? value.__struct__ : undefined;
const __collectionInfo__ = (value) => {
  const kind = Data.dataKind(value);
  const state = kind === 'array' || kind === 'many' ? value.__collection__ : undefined;
  if (!state) return undefined;
  if (state.lengthOffset != null) state.length = state.root.storage[state.lengthOffset];
  state.storage = state.root.storage;
  state.revision = state.root.revision;
  return state;
};
const __round__ = (value, alignment) => Math.ceil(value / alignment) * alignment;
function __changeTracker__(storage) {
  return { storage, revision: 0, dirtyStart: 0, dirtyEnd: storage.length };
}
function __changed__(root, start, end) {
  root.revision++;
  root.dirtyStart = Math.min(root.dirtyStart, start);
  root.dirtyEnd = Math.max(root.dirtyEnd, end);
}
function __arrayType__(type, capacity) {
  type = NumericTypes.canonicalType(type);
  if (!Number.isSafeInteger(capacity) || capacity <= 0 || capacity > 16777216)
    throw new RangeError('Array capacity must be a positive integer within the f32 indexing range');
  const element = __elementInfo__(type),
    align = element.align,
    stride = __round__(element.size, align);
  return {
    type: 'array',
    element,
    elementType: type,
    capacity,
    stride,
    dataOffset: 0,
    align,
    size: stride * capacity,
    __layout__: true,
  };
}
function __manyType__(type, capacity) {
  const array = __arrayType__(type, capacity),
    dataOffset = __round__(1, array.align);
  return { ...array, type: 'many', dataOffset, size: dataOffset + array.size };
}
function __sameElement__(a, b) {
  if (a === b) return true;
  if (a.fields || b.fields) return false;
  if (['array', 'many'].includes(a.type) || ['array', 'many'].includes(b.type))
    return a.type === b.type && a.capacity === b.capacity && __sameElement__(a.element, b.element);
  return a.type === b.type;
}

function __elementInfo__(type) {
  type = NumericTypes.canonicalType(type);
  if (type?.__layout__) return type;
  if (__structDefinitionInfo__(type)) return __structDefinitionInfo__(type);
  if (type === 'bool') return { type: 'bool', size: 1, align: 1 };
  if (NumericTypes.scalarTypes.includes(type)) return { type, size: 1, align: 1 };
  if (NumericTypes.vectorInfo(type)) {
    const n = NumericTypes.vectorInfo(type).size;
    return { type, size: n, align: n === 2 ? 2 : 4 };
  }
  if (/^mat([234])x\1f$/.test(type)) {
    const n = NumericTypes.matrixSize(type),
      align = n === 2 ? 2 : 4;
    return { type, size: n * align, align, columns: n };
  }
  throw new TypeError(
    'Elements must be bool, f32/i32/u32, vectors, matrices, structs, or bounded array/many types',
  );
}

function __checked__(value, type = 'f32') {
  if (type === 'i32' || type === 'u32') {
    if (!NumericTypes.scalarMatches(value, type)) throw new TypeError(`Expected ${type} component`);
    return value;
  }
  if (typeof value !== 'number' || !Number.isFinite(Math.fround(value)))
    throw new TypeError('Numeric components must be finite f32 values');
  return type === 'f32' ? Math.fround(value) : value;
}
function __encode__(info, value) {
  if (info.type === 'bool') {
    if (typeof value !== 'boolean') throw new TypeError('Expected bool');
    return [value ? 1 : 0];
  }
  if (info.type === 'array' || info.type === 'many') {
    const state = __collectionInfo__(value);
    if (
      Data.dataKind(value) !== info.type ||
      !state ||
      !__sameElement__(state.element, info.element) ||
      state.length > info.capacity
    )
      throw new TypeError(
        `Expected ${info.type} with compatible elements within the field capacity`,
      );
    const packed = Array(info.size).fill(0);
    if (info.type === 'many') packed[0] = state.length;
    for (let i = 0; i < state.length; i++)
      packed.splice(
        info.dataOffset + i * info.stride,
        info.element.size,
        ...__encode__(info.element, __structuredGet__(value, i)),
      );
    return packed;
  }
  if (info.fields) {
    const instance = __structInfo__(value);
    if (!instance || instance.definition !== info)
      throw new TypeError(`Expected a ${info.name} instance`);
    return Array.from(instance.root.storage.subarray(instance.offset, instance.offset + info.size));
  }
  if (NumericTypes.scalarTypes.includes(info.type)) return [__checked__(value, info.type)];
  const vector = NumericTypes.vectorInfo(info.type),
    count = vector?.size || NumericTypes.matrixSize(info.type);
  if (
    Data.dataKind(value) !== info.type ||
    Data.values(value).length !== (info.columns ? count * count : count)
  )
    throw new TypeError(`Expected ${info.type}`);
  const values = Array.from(Data.values(value), (value) =>
    __checked__(value, vector?.scalar || 'f32'),
  );
  if (!info.columns) return values;
  const packed = Array(info.size).fill(0);
  for (let column = 0; column < count; column++)
    packed.splice(
      column * info.align,
      count,
      ...values.slice(column * count, (column + 1) * count),
    );
  return packed;
}
function __write__(info, root, offset, value) {
  const packed = __encode__(info, value);
  root.storage.set(packed, offset);
  __changed__(root, offset, offset + info.size);
}
function __read__(info, root, offset) {
  if (info.type === 'bool') return root.storage[offset] !== 0;
  if (NumericTypes.scalarTypes.includes(info.type)) return root.storage[offset];
  if (info.type === 'array' || info.type === 'many') {
    const state = {
      type: info.elementType,
      element: info.element,
      stride: info.stride,
      capacity: info.capacity,
      length: info.capacity,
      bounded: true,
      root,
      storage: root.storage,
      offset: offset + info.dataOffset,
      views: new Map(),
      lengthOffset: info.type === 'many' ? offset : null,
    };
    return Data.registerData({ type: info.type, __collection__: state }, info.type);
  }
  if (info.fields) return __structView__(info, root, offset);
  const n = NumericTypes.vectorInfo(info.type)?.size || NumericTypes.matrixSize(info.type);
  return __markCheckedView__(
    Data.registerData(
      {
        ...(info.columns ? { type: info.type } : { __type__: info.type }),
        __numericView__: { info, root, offset, length: info.columns ? n * n : n },
      },
      info.type,
    ),
  );
}
function __numericValues__(value) {
  const { info, root, offset, length } = value.__numericView__;
  const n = NumericTypes.matrixSize(info.type);
  return Array.from(
    { length },
    (_, i) => root.storage[offset + (info.columns ? Math.floor(i / n) * info.align + (i % n) : i)],
  );
}
function __numericPut__(value, index, component) {
  const { info, root, offset, length } = value.__numericView__;
  if (!Number.isSafeInteger(index) || index < 0 || index >= length)
    throw new RangeError('Numeric index must be within bounds');
  const n = NumericTypes.matrixSize(info.type),
    position = offset + (info.columns ? Math.floor(index / n) * info.align + (index % n) : index);
  root.storage[position] = __checked__(
    component,
    NumericTypes.vectorInfo(info.type)?.scalar || 'f32',
  );
  __changed__(root, position, position + 1);
}
function __structView__(definition, root, offset) {
  return Data.registerData(
    { type: 'struct', __struct__: { definition, root, offset, children: new Map() } },
    'struct',
  );
}

function __createStruct__(name, declarations) {
  let size = 0,
    align = 1;
  const keys = new Set();
  const fields = declarations.map(([key, type], index) => {
    type = NumericTypes.canonicalType(type);
    if (typeof key !== 'string' || keys.has(key))
      throw new TypeError(`Invalid or duplicate struct field: ${key}`);
    keys.add(key);
    const info = __elementInfo__(type),
      offset = __round__(size, info.align);
    size = offset + info.size;
    align = Math.max(align, info.align);
    return { key, type, info, offset, index };
  });
  if (!fields.length) throw new TypeError('A struct requires at least one field');
  const descriptor = { name, fields: fields, size: __round__(size, align), align };
  const fieldsByKey = new Map(fields.map((field) => [field.key, field]));
  const constructor = (...entries) => {
    if (entries.length !== fields.length * 2)
      throw new TypeError(`${name} requires all ${fields.length} fields exactly once`);
    const storage = new Float64Array(descriptor.size),
      root = __changeTracker__(storage),
      supplied = new Set();
    for (let i = 0; i < entries.length; i += 2) {
      const key = entries[i],
        field = fieldsByKey.get(key);
      if (!field || supplied.has(key))
        throw new TypeError(`Unknown or duplicate ${name} field: ${key}`);
      supplied.add(key);
      __write__(field.info, root, field.offset, entries[i + 1]);
    }
    return __structView__(descriptor, root, 0);
  };
  constructor.__definition__ = descriptor;
  return constructor;
}

function __createZeroArray__(type, length) {
  type = NumericTypes.canonicalType(type);
  if (arguments.length !== 2)
    throw new TypeError('Array allocation expects an element type and length');
  if (!Number.isSafeInteger(length) || length < 0)
    throw new RangeError('Array length must be a non-negative safe integer');
  const element = __elementInfo__(type),
    stride = __round__(element.size, element.align);
  const storage = new (__containsIntegers__(element) ? Float64Array : Float32Array)(
    stride * length,
  );
  const tracker = __changeTracker__(storage);
  const state = {
    type,
    element,
    stride,
    length,
    capacity: length,
    bounded: true,
    storage,
    root: tracker,
    offset: 0,
    views: new Map(),
    revision: 0,
    dirtyStart: 0,
    dirtyEnd: storage.length,
  };
  const result = Data.registerData({ type: 'array', __collection__: state }, 'array');
  return result;
}

function __createArray__(type, capacity, ...values) {
  const bounded = capacity !== undefined;
  if (bounded) __arrayType__(type, capacity);
  const result = __createZeroArray__(type, bounded ? capacity : values.length),
    state = __collectionInfo__(result);
  if (values.length > state.capacity)
    throw new RangeError('Array initializer exceeds its capacity');
  state.bounded = true;
  values.forEach((value, i) => __write__(state.element, state.root, i * state.stride, value));
  return result;
}
function __createMany__(type, capacity, ...values) {
  const backing = __createArray__(type, capacity, ...values),
    state = __collectionInfo__(backing);
  state.length = values.length;
  state.bounded = capacity !== undefined;
  const result = Data.registerData({ type: 'many', __collection__: state }, 'many');
  return result;
}
function __manyInsert__(value, replacement, at) {
  const state = __collectionInfo__(value);
  if (at === undefined) at = state.length;
  if (!Number.isSafeInteger(at) || at < 0 || at > state.length)
    throw new RangeError('many insertion index must be within bounds');
  const packed = __encode__(state.element, replacement);
  if (state.length === state.capacity) {
    if (state.bounded) throw new RangeError('many capacity exceeded');
    const capacity = Math.min(16777216, Math.max(1, state.capacity * 2));
    if (capacity <= state.capacity) throw new RangeError('many exceeds the f32 indexing range');
    const storage = new state.storage.constructor(capacity * state.stride);
    storage.set(state.storage);
    state.storage = storage;
    state.root.storage = storage;
    state.capacity = capacity;
  }
  const start = (state.offset || 0) + at * state.stride,
    end = (state.offset || 0) + state.length * state.stride;
  state.storage.copyWithin(start + state.stride, start, end);
  state.storage.fill(0, start, start + state.stride);
  state.storage.set(packed, start);
  state.length++;
  __changed__(state.root, start, end + state.stride);
  if (state.lengthOffset != null) state.root.storage[state.lengthOffset] = state.length;
  return value;
}
function __manyRemove__(value, at) {
  if (at === null) return value;
  const state = __collectionInfo__(value);
  if (!Number.isSafeInteger(at) || at < 0 || at >= state.length)
    throw new RangeError('many removal index must be within bounds');
  const start = (state.offset || 0) + at * state.stride,
    end = (state.offset || 0) + state.length * state.stride;
  state.storage.copyWithin(start, start + state.stride, end);
  state.length--;
  __changed__(state.root, start, end);
  if (state.lengthOffset != null) state.root.storage[state.lengthOffset] = state.length;
  return value;
}

function __structuredGet__(value, key) {
  const definition = __structDefinitionInfo__(value);
  if (definition) {
    const field = __structField__(definition, key);
    if (!field) throw new TypeError(`Unknown ${definition.name} field: ${key}`);
    return field.type;
  }
  const instance = __structInfo__(value);
  if (instance) {
    const field = __structField__(instance.definition, key);
    if (typeof key !== 'string' || !field)
      throw new TypeError(`Unknown ${instance.definition.name} field: ${key}`);
    if (field.info.type === 'bool' || NumericTypes.scalarTypes.includes(field.info.type))
      return __read__(field.info, instance.root, instance.offset + field.offset);
    if (!instance.children.has(key))
      instance.children.set(
        key,
        __read__(field.info, instance.root, instance.offset + field.offset),
      );
    return instance.children.get(key);
  }
  const state = __collectionInfo__(value);
  if (!Number.isSafeInteger(key) || key < 0 || key >= state.length)
    throw new RangeError('Array index must be an integer within bounds');
  if (NumericTypes.scalarTypes.includes(state.element.type))
    return state.storage[(state.offset || 0) + key * state.stride];
  if (state.element.type === 'bool')
    return state.storage[(state.offset || 0) + key * state.stride] !== 0;
  if (!state.views.has(key))
    state.views.set(
      key,
      __read__(state.element, state.root, (state.offset || 0) + key * state.stride),
    );
  return state.views.get(key);
}
function __structuredPut__(value, key, replacement) {
  if (__structDefinitionInfo__(value)) throw new TypeError('Struct definitions cannot be mutated');
  const instance = __structInfo__(value);
  if (instance) {
    __structuredGet__(value, key);
    const field = __structField__(instance.definition, key);
    __write__(field.info, instance.root, instance.offset + field.offset, replacement);
    return value;
  }
  const state = __collectionInfo__(value);
  if (!Number.isSafeInteger(key) || key < 0 || key >= state.length)
    throw new RangeError('Array index must be an integer within bounds');
  __write__(state.element, state.root, (state.offset || 0) + key * state.stride, replacement);
  return value;
}
function __structuredCopy__(value) {
  const instance = __structInfo__(value);
  if (instance)
    return __structView__(
      instance.definition,
      __changeTracker__(
        new Float64Array(
          instance.root.storage.slice(instance.offset, instance.offset + instance.definition.size),
        ),
      ),
      0,
    );
  const state = __collectionInfo__(value),
    result =
      Data.dataKind(value) === 'many'
        ? __createMany__(state.type, state.capacity || undefined)
        : __createZeroArray__(state.type, state.capacity),
    duplicate = __collectionInfo__(result);
  duplicate.storage.set(
    state.storage.subarray(state.offset || 0, (state.offset || 0) + state.capacity * state.stride),
  );
  duplicate.length = state.length;
  duplicate.bounded = state.bounded;
  return result;
}
function __structuredLen__(value) {
  return (
    __collectionInfo__(value)?.length ??
    (__structInfo__(value)?.definition || __structDefinitionInfo__(value)).fields.length
  );
}

function __isHostShareable__(info) {
  if (info.fields) return info.fields.every((field) => __isHostShareable__(field.info));
  if (info.element) return __isHostShareable__(info.element);
  return info.type !== 'bool';
}
function __containsIntegers__(info) {
  if (info.fields) return info.fields.some((field) => __containsIntegers__(field.info));
  if (info.element) return __containsIntegers__(info.element);
  return ['i32', 'u32'].includes(NumericTypes.vectorInfo(info.type)?.scalar || info.type);
}
function __packCollection__(state) {
  if (!__isHostShareable__(state.element))
    throw new TypeError('Boolean fields and elements cannot cross the host/GPU boundary');
  const start = state.offset || 0;
  if (!__containsIntegers__(state.element))
    return new Float32Array(state.storage.subarray(start, start + state.capacity * state.stride));
  const bytes = new Uint8Array(state.capacity * state.stride * 4),
    view = new DataView(bytes.buffer);
  const component = (type, source, target) => {
    const value = state.storage[source];
    if (type === 'i32') view.setInt32(target * 4, value, true);
    else if (type === 'u32') view.setUint32(target * 4, value, true);
    else view.setFloat32(target * 4, value, true);
  };
  const pack = (info, source, target) => {
    if (info.fields) {
      for (const field of info.fields)
        pack(field.info, source + field.offset, target + field.offset);
      return;
    }
    if (info.element) {
      if (info.type === 'many') component('f32', source, target);
      for (let i = 0; i < info.capacity; i++)
        pack(
          info.element,
          source + info.dataOffset + i * info.stride,
          target + info.dataOffset + i * info.stride,
        );
      return;
    }
    const vector = NumericTypes.vectorInfo(info.type);
    for (let i = 0; i < info.size; i++)
      component(vector?.scalar || info.type, source + i, target + i);
  };
  for (let i = 0; i < state.capacity; i++)
    pack(state.element, start + i * state.stride, i * state.stride);
  return bytes;
}

export const Structures = {
  structField: __structField__,
  markCheckedView: __markCheckedView__,
  isCheckedView: __isCheckedView__,
  structDefinitionInfo: __structDefinitionInfo__,
  structInfo: __structInfo__,
  collectionInfo: __collectionInfo__,
  arrayType: __arrayType__,
  manyType: __manyType__,
  sameElement: __sameElement__,
  elementInfo: __elementInfo__,
  numericValues: __numericValues__,
  numericPut: __numericPut__,
  createStruct: __createStruct__,
  createZeroArray: __createZeroArray__,
  createArray: __createArray__,
  createMany: __createMany__,
  manyInsert: __manyInsert__,
  manyRemove: __manyRemove__,
  structuredGet: __structuredGet__,
  structuredPut: __structuredPut__,
  structuredCopy: __structuredCopy__,
  structuredLen: __structuredLen__,
  isHostShareable: __isHostShareable__,
  packCollection: __packCollection__,
};
