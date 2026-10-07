import { dataKind, registerData } from './data.js';
import { scalarTypes, vectorInfo, scalarMatches, matrixSize, canonicalType } from './numeric-types.js';

const structDefinitions = new WeakMap(), structInstances = new WeakMap(), collections = new WeakMap();
const structFields = new WeakMap();
export const structField = (definition, key) => structFields.get(definition)?.get(key);
const checkedViews = new WeakSet();
export function markCheckedView(value) { checkedViews.add(value); return value; }
export const isCheckedView = value => checkedViews.has(value);
export const structDefinitionInfo = value => structDefinitions.get(value);
export const structInfo = value => structInstances.get(value);
export const collectionInfo = value => collections.get(value);
const round = (value, alignment) => Math.ceil(value / alignment) * alignment;
function changeTracker() {
  let revision = 0;
  const changed = () => { revision++; };
  Object.defineProperty(changed, 'revision', { get: () => revision });
  return changed;
}
const arrayTypes = new Map(), objectArrayTypes = new WeakMap();
const manyTypes = new Map(), objectManyTypes = new WeakMap();
const arrayTypeCache = type => type !== null && ['object', 'function'].includes(typeof type) ? objectArrayTypes : arrayTypes;
export function arrayType(type, capacity) {
  type = canonicalType(type);
  if (!Number.isSafeInteger(capacity) || capacity <= 0 || capacity > 16777216) throw new RangeError('Array capacity must be a positive integer within the f32 indexing range');
  const registry = arrayTypeCache(type);
  if (!registry.has(type)) registry.set(type, new Map());
  const cache = registry.get(type);
  if (!cache.has(capacity)) {
    const element = elementInfo(type), align = element.align, stride = round(element.size, align), dataOffset = 0;
    cache.set(capacity, Object.freeze({ type: 'array', element, elementType: type, capacity, stride, dataOffset, align, size: dataOffset + stride * capacity }));
  }
  return cache.get(capacity);
}
export function manyType(type, capacity) {
  type = canonicalType(type);
  const array = arrayType(type, capacity);
  const registry = type !== null && ['object', 'function'].includes(typeof type) ? objectManyTypes : manyTypes;
  if (!registry.has(type)) registry.set(type, new Map());
  const cache = registry.get(type);
  if (!cache.has(capacity)) {
    const dataOffset = round(1, array.align);
    cache.set(capacity, Object.freeze({ ...array, type: 'many', dataOffset, size: dataOffset + array.size }));
  }
  return cache.get(capacity);
}
export function sameElement(a, b) {
  if (a === b) return true;
  if (a.fields || b.fields) return false;
  if (['array', 'many'].includes(a.type) || ['array', 'many'].includes(b.type)) return a.type === b.type && a.capacity === b.capacity && sameElement(a.element, b.element);
  return a.type === b.type;
}

export function elementInfo(type) {
  type = canonicalType(type);
  if (type?.type === 'many') {
    const registry = type.elementType !== null && ['object', 'function'].includes(typeof type.elementType) ? objectManyTypes : manyTypes;
    if (registry.get(type.elementType)?.get(type.capacity) === type) return type;
  }
  if (type?.type === 'array' && arrayTypeCache(type.elementType).get(type.elementType)?.get(type.capacity) === type) return type;
  if (structDefinitionInfo(type)) return structDefinitionInfo(type);
  if (type === 'bool') return { type: 'bool', size: 1, align: 1 };
  if (scalarTypes.includes(type)) return { type, size: 1, align: 1 };
  if (vectorInfo(type)) {
    const n = vectorInfo(type).size; return { type, size: n, align: n === 2 ? 2 : 4 };
  }
  if (/^mat([234])x\1f$/.test(type)) {
    const n = matrixSize(type), align = n === 2 ? 2 : 4;
    return { type, size: n * align, align, columns: n };
  }
  throw new TypeError('Elements must be bool, f32/i32/u32, vectors, matrices, structs, or bounded array/many types');
}

function checked(value, type = 'f32') {
  if (type === 'i32' || type === 'u32') {
    if (!scalarMatches(value, type)) throw new TypeError(`Expected ${type} component`);
    return value;
  }
  if (typeof value !== 'number' || !Number.isFinite(Math.fround(value))) throw new TypeError('Numeric components must be finite f32 values');
  return type === 'f32' ? Math.fround(value) : value;
}
function encode(info, value) {
  if (info.type === 'bool') {
    if (typeof value !== 'boolean') throw new TypeError('Expected bool');
    return [value ? 1 : 0];
  }
  if (info.type === 'array' || info.type === 'many') {
    const state = collectionInfo(value);
    if (dataKind(value) !== info.type || !state || !sameElement(state.element, info.element) || state.length > info.capacity) throw new TypeError(`Expected ${info.type} with compatible elements within the field capacity`);
    const packed = Array(info.size).fill(0);
    if (info.type === 'many') packed[0] = state.length;
    for (let i = 0; i < state.length; i++) packed.splice(info.dataOffset + i * info.stride, info.element.size, ...encode(info.element, structuredGet(value, i)));
    return packed;
  }
  if (info.fields) {
    const instance = structInfo(value);
    if (!instance || instance.definition !== info) throw new TypeError(`Expected a ${info.name} instance`);
    return Array.from(instance.storage.subarray(instance.offset, instance.offset + info.size));
  }
  if (scalarTypes.includes(info.type)) return [checked(value, info.type)];
  const vector = vectorInfo(info.type), count = vector?.size || matrixSize(info.type);
  if (dataKind(value) !== info.type || value.values.length !== (info.columns ? count * count : count)) throw new TypeError(`Expected ${info.type}`);
  const values = Array.from(value.values, value => checked(value, vector?.scalar || 'f32'));
  if (!info.columns) return values;
  const packed = Array(info.size).fill(0);
  for (let column = 0; column < count; column++) packed.splice(column * info.align, count, ...values.slice(column * count, (column + 1) * count));
  return packed;
}
function write(info, storage, offset, value, changed) {
  const packed = encode(info, value); // Validate the complete write before mutation.
  storage.set(packed, offset);
  changed?.(offset, offset + info.size);
}
function read(info, storage, offset, changed) {
  if (info.type === 'bool') return storage[offset] !== 0;
  if (info.type === 'array' || info.type === 'many') {
    const result = registerData(Object.freeze({ type: info.type }), info.type);
    const state = { type: info.elementType, element: info.element, stride: info.stride, capacity: info.capacity, length: info.capacity, bounded: true, storage, offset: offset + info.dataOffset, views: new Map(), changed,
      get revision() { return changed?.revision || 0; },
    };
    if (info.type === 'many') Object.defineProperty(state, 'length', { get: () => storage[offset], set: value => { storage[offset] = value; changed?.(offset, offset + 1); } });
    collections.set(result, state);
    return result;
  }
  if (scalarTypes.includes(info.type)) return storage[offset];
  if (info.fields) return structView(info, storage, offset, changed);
  const vector = vectorInfo(info.type), n = vector?.size || matrixSize(info.type), length = info.columns ? n * n : n;
  const values = Array(length);
  for (let i = 0; i < length; i++) {
    const position = offset + (info.columns ? Math.floor(i / n) * info.align + i % n : i);
    Object.defineProperty(values, i, { enumerable: true, configurable: false,
      get: () => storage[position], set: value => { storage[position] = checked(value, vector?.scalar || 'f32'); changed?.(position, position + 1); } });
  }
  Object.seal(values); Object.defineProperty(values, 'length', { writable: false });
  return markCheckedView(registerData(Object.freeze({ type: info.type, values }), info.type));
}
function structView(definition, storage, offset, changed) {
  const values = Object.create(null), children = new Map();
  for (const field of definition.fields) {
    Object.defineProperty(values, field.key, { enumerable: true,
      get: () => {
        if (field.info.type === 'bool') return read(field.info, storage, offset + field.offset, changed);
        if (scalarTypes.includes(field.info.type)) return storage[offset + field.offset];
        if (!children.has(field.key)) children.set(field.key, read(field.info, storage, offset + field.offset, changed));
        return children.get(field.key);
      },
      set: value => write(field.info, storage, offset + field.offset, value, changed),
    });
  }
  Object.preventExtensions(values);
  const result = registerData(Object.freeze({ type: 'struct', values }), 'struct');
  structInstances.set(result, { definition, storage, offset, changed });
  return result;
}

export function createStruct(name, declarations) {
  let size = 0, align = 1;
  const keys = new Set();
  const fields = declarations.map(([key, type], index) => {
    type = canonicalType(type);
    if (typeof key !== 'string' || keys.has(key)) throw new TypeError(`Invalid or duplicate struct field: ${key}`);
    keys.add(key);
    const info = elementInfo(type), offset = round(size, info.align);
    size = offset + info.size; align = Math.max(align, info.align);
    return Object.freeze({ key, type, info, offset, index });
  });
  if (!fields.length) throw new TypeError('A struct requires at least one field');
  const descriptor = Object.freeze({ name, fields: Object.freeze(fields), size: round(size, align), align });
  const fieldsByKey = new Map(fields.map(field => [field.key, field]));
  structFields.set(descriptor, fieldsByKey);
  const constructor = (...entries) => {
    if (entries.length !== fields.length * 2) throw new TypeError(`${name} requires all ${fields.length} fields exactly once`);
    const storage = new Float64Array(descriptor.size), supplied = new Set();
    for (let i = 0; i < entries.length; i += 2) {
      const key = entries[i], field = fieldsByKey.get(key);
      if (!field || supplied.has(key)) throw new TypeError(`Unknown or duplicate ${name} field: ${key}`);
      supplied.add(key); write(field.info, storage, field.offset, entries[i + 1]);
    }
    return structView(descriptor, storage, 0, changeTracker());
  };
  structDefinitions.set(constructor, descriptor);
  return Object.freeze(constructor);
}

export function createZeroArray(type, length) {
  type = canonicalType(type);
  if (arguments.length !== 2) throw new TypeError('Array allocation expects an element type and length');
  if (!Number.isSafeInteger(length) || length < 0) throw new RangeError('Array length must be a non-negative safe integer');
  const element = elementInfo(type), stride = round(element.size, element.align);
  const storage = new (containsIntegers(element) ? Float64Array : Float32Array)(stride * length);
  const state = { type, element, stride, length, capacity: length, bounded: true, storage, offset: 0, views: new Map(), revision: 0, dirtyStart: 0, dirtyEnd: storage.length };
  state.changed = (start, end) => { state.revision++; state.dirtyStart = Math.min(state.dirtyStart, start); state.dirtyEnd = Math.max(state.dirtyEnd, end); };
  Object.defineProperty(state.changed, 'revision', { get: () => state.revision });
  const result = registerData(Object.freeze({ type: 'array' }), 'array');
  collections.set(result, state);
  return result;
}

export function createArray(type, capacity, ...values) {
  const bounded = capacity !== undefined;
  if (bounded) arrayType(type, capacity);
  const result = createZeroArray(type, bounded ? capacity : values.length), state = collectionInfo(result);
  if (values.length > state.capacity) throw new RangeError('Array initializer exceeds its capacity');
  state.bounded = true;
  values.forEach((value, i) => write(state.element, state.storage, i * state.stride, value));
  return result;
}
export function createMany(type, capacity, ...values) {
  const backing = createArray(type, capacity, ...values), state = collectionInfo(backing);
  state.length = values.length; state.bounded = capacity !== undefined;
  state.viewStorage = new Proxy({}, {
    get: (_, key) => typeof state.storage[key] === 'function' ? state.storage[key].bind(state.storage) : state.storage[key],
    set: (_, key, value) => { state.storage[key] = value; return true; },
  });
  const result = registerData(Object.freeze({ type: 'many' }), 'many');
  collections.set(result, state);
  return result;
}
export function manyInsert(value, replacement, at) {
  const state = collectionInfo(value);
  if (at === undefined) at = state.length;
  if (!Number.isSafeInteger(at) || at < 0 || at > state.length) throw new RangeError('many insertion index must be within bounds');
  const packed = encode(state.element, replacement);
  if (state.length === state.capacity) {
    if (state.bounded) throw new RangeError('many capacity exceeded');
    const capacity = Math.min(16777216, Math.max(1, state.capacity * 2));
    if (capacity <= state.capacity) throw new RangeError('many exceeds the f32 indexing range');
    const storage = new state.storage.constructor(capacity * state.stride);
    storage.set(state.storage); state.storage = storage; state.capacity = capacity;
  }
  const start = (state.offset || 0) + at * state.stride, end = (state.offset || 0) + state.length * state.stride;
  state.storage.copyWithin(start + state.stride, start, end);
  state.storage.fill(0, start, start + state.stride); state.storage.set(packed, start);
  state.length++;
  state.changed?.(start, end + state.stride);
  return value;
}
export function manyRemove(value, at) {
  if (at === null) return value;
  const state = collectionInfo(value);
  if (!Number.isSafeInteger(at) || at < 0 || at >= state.length) throw new RangeError('many removal index must be within bounds');
  const start = (state.offset || 0) + at * state.stride, end = (state.offset || 0) + state.length * state.stride;
  state.storage.copyWithin(start, start + state.stride, end);
  state.length--;
  state.changed?.(start, end);
  return value;
}

export function structuredGet(value, key) {
  const definition = structDefinitionInfo(value);
  if (definition) {
    const field = structField(definition, key);
    if (!field) throw new TypeError(`Unknown ${definition.name} field: ${key}`);
    return field.type;
  }
  const instance = structInfo(value);
  if (instance) {
    if (typeof key !== 'string' || !Object.hasOwn(value.values, key)) throw new TypeError(`Unknown ${instance.definition.name} field: ${key}`);
    return value.values[key];
  }
  const state = collectionInfo(value);
  if (!Number.isSafeInteger(key) || key < 0 || key >= state.length) throw new RangeError('Array index must be an integer within bounds');
  if (scalarTypes.includes(state.element.type)) return state.storage[(state.offset || 0) + key * state.stride];
  if (state.element.type === 'bool') return state.storage[(state.offset || 0) + key * state.stride] !== 0;
  if (!state.views.has(key)) state.views.set(key, read(state.element, state.viewStorage || state.storage, (state.offset || 0) + key * state.stride, state.changed));
  return state.views.get(key);
}
export function structuredPut(value, key, replacement) {
  if (structDefinitionInfo(value)) throw new TypeError('Struct definitions cannot be mutated');
  const instance = structInfo(value);
  if (instance) { structuredGet(value, key); value.values[key] = replacement; return value; }
  const state = collectionInfo(value);
  if (!Number.isSafeInteger(key) || key < 0 || key >= state.length) throw new RangeError('Array index must be an integer within bounds');
  write(state.element, state.storage, (state.offset || 0) + key * state.stride, replacement, state.changed);
  return value;
}
export function structuredCopy(value) {
  const instance = structInfo(value);
  if (instance) return structView(instance.definition, new Float64Array(instance.storage.slice(instance.offset, instance.offset + instance.definition.size)), 0, changeTracker());
  const state = collectionInfo(value), result = dataKind(value) === 'many' ? createMany(state.type, state.capacity || undefined) : createZeroArray(state.type, state.capacity), duplicate = collectionInfo(result);
  duplicate.storage.set(state.storage.subarray(state.offset || 0, (state.offset || 0) + state.capacity * state.stride));
  duplicate.length = state.length; duplicate.bounded = state.bounded;
  return result;
}
export function structuredLen(value) {
  return collectionInfo(value)?.length ?? (structInfo(value)?.definition || structDefinitionInfo(value)).fields.length;
}

function containsIntegers(info) {
  if (info.fields) return info.fields.some(field => containsIntegers(field.info));
  if (info.element) return containsIntegers(info.element);
  return ['i32', 'u32'].includes(vectorInfo(info.type)?.scalar || info.type);
}
export function packCollection(state) {
  const start = state.offset || 0;
  if (!containsIntegers(state.element)) return new Float32Array(state.storage.subarray(start, start + state.capacity * state.stride));
  const bytes = new Uint8Array(state.capacity * state.stride * 4), view = new DataView(bytes.buffer);
  const component = (type, source, target) => {
    const value = state.storage[source];
    if (type === 'i32') view.setInt32(target * 4, value, true);
    else if (type === 'u32') view.setUint32(target * 4, value, true);
    else view.setFloat32(target * 4, value, true);
  };
  const pack = (info, source, target) => {
    if (info.fields) { for (const field of info.fields) pack(field.info, source + field.offset, target + field.offset); return; }
    if (info.element) {
      if (info.type === 'many') component('f32', source, target);
      for (let i = 0; i < info.capacity; i++) pack(info.element, source + info.dataOffset + i * info.stride, target + info.dataOffset + i * info.stride);
      return;
    }
    const vector = vectorInfo(info.type);
    for (let i = 0; i < info.size; i++) component(vector?.scalar || info.type, source + i, target + i);
  };
  for (let i = 0; i < state.capacity; i++) pack(state.element, start + i * state.stride, i * state.stride);
  return bytes;
}
