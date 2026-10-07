import { structDefinitionInfo, structInfo, collectionInfo, structuredGet, structuredPut, structuredCopy, structuredLen, isCheckedView, markCheckedView, sameElement, manyInsert, manyRemove } from './structures.js';
import { vectorInfo, convertComponent, scalarMatches, matrixSize } from './numeric-types.js';
// Tags are serializable; registration distinguishes language values from host objects.
const kinds = new WeakMap();
export function registerData(value, kind) { kinds.set(value, kind); return value; }
const opaque = new WeakSet();
const textureSizes = new WeakMap();
export function registerTextureSize(handle, width, height) { textureSizes.set(handle, [width, height]); }
export const normalizeNil = value => value === undefined ? null : value;
export function bool(value) {
  if (arguments.length !== 1) throw new TypeError('bool expects exactly one value');
  if (value === null || value === undefined || value === false || value === '' || value === 0 || Number.isNaN(value)) return false;
  const kind = dataKind(value);
  if (kind === 'many') return collectionInfo(value).length !== 0;
  if (kind === 'list') return value.values.length !== 0;
  if (kind === 'dict') return Object.keys(value.values).length !== 0;
  return true;
}
export function registerOpaque(value) { opaque.add(value); return value; }
export const dataKind = value => value !== null && typeof value === 'object' ? kinds.get(value) : undefined;

function languageValue(value) {
  value = normalizeNil(value);
  if (value === null || ['undefined', 'number', 'string', 'boolean', 'function'].includes(typeof value) || dataKind(value) || opaque.has(value)) return value;
  throw new TypeError('Collections require primitives or language values');
}

function tagged(type, values) {
  // Metadata is fixed; the backing storage is mutable.
  if (vectorInfo(type) || /^mat([234])x\1f$/.test(type)) {
    return numericFromComponents(type, values);
  }
  const result = Object.freeze({ type, values });
  kinds.set(result, type);
  return result;
}

export const list = (...values) => tagged('list', values.map(languageValue));
export function dict(...entries) {
  if (entries.length % 2) throw new TypeError('dict expects key/value pairs');
  const values = Object.create(null);
  for (let i = 0; i < entries.length; i += 2) {
    if (typeof entries[i] !== 'string') throw new TypeError('dict keys must be strings');
    values[entries[i]] = languageValue(entries[i + 1]);
  }
  return tagged('dict', values);
}

export function vector(size, values, type = `vec${size}f`) {
  const info = vectorInfo(type);
  const components = values.flatMap(value => {
    if (typeof value === 'number') return [value];
    if (vectorInfo(dataKind(value))) return Array.from(value.values);
    throw new TypeError(`${type}: expected numeric scalars or vectors`);
  });
  if (!components.length && info.suffix) components.push(...Array(size).fill(0));
  if (components.length === 1) components.push(...Array(size - 1).fill(components[0]));
  if (components.length !== size) throw new TypeError(`${type}: expected ${size} components or one scalar to splat`);
  return tagged(type, components.map(value => convertComponent(value, info.scalar)));
}

// Internal fixed-storage constructor for vectors/matrices. Generated swizzles
// supply a fresh array from an already validated target in the same family.
export function numericFromComponents(type, components) {
  Object.seal(components);
  Object.defineProperty(components, 'length', { writable: false });
  return registerData(Object.freeze({ type, values: components }), type);
}

export function matrix(size, values) {
  if (!values.length) return tagged(`mat${size}x${size}f`, Array(size * size).fill(0));
  if (values.length === size && values.every(value => vectorInfo(dataKind(value))?.size === size && ['f32'].includes(vectorInfo(dataKind(value)).scalar))) {
    return tagged(`mat${size}x${size}f`, values.flatMap(value => Array.from(value.values, Math.fround)));
  }
  if (values.length === size * size && values.every(value => typeof value === 'number')) {
    return tagged(`mat${size}x${size}f`, values.map(Math.fround));
  }
  throw new TypeError(`mat${size}x${size}f: expected no arguments, ${size} float-vector columns, or ${size * size} scalars`);
}

const matrixColumns = new WeakMap();
export function matrixColumn(value, column) {
  const kind = dataKind(value), size = matrixSize(kind);
  if (!/^mat([234])x\1f$/.test(kind || '')) throw new TypeError('Expected a matrix');
  index(column, size);
  if (!matrixColumns.has(value)) matrixColumns.set(value, new Map());
  const columns = matrixColumns.get(value);
  if (!columns.has(column)) {
    const values = Array(size);
    for (let row = 0; row < size; row++) {
      const offset = column * size + row;
      Object.defineProperty(values, row, { enumerable: true,
        get: () => value.values[offset], set: component => { put(value, offset, component); } });
    }
    Object.seal(values); Object.defineProperty(values, 'length', { writable: false });
    const result = registerData(Object.freeze({ type: `vec${size}f`, values }), `vec${size}f`);
    columns.set(column, isCheckedView(value) ? markCheckedView(result) : result);
  }
  return columns.get(column);
}

export function copy(value) {
  value = normalizeNil(value);
  const kind = dataKind(value);
  if (kind === 'struct' || kind === 'array' || kind === 'many') return structuredCopy(value);
  if (!kind) return value; // Primitive values, functions, and opaque handles retain identity.
  return tagged(kind, kind === 'dict' ? Object.assign(Object.create(null), value.values) : [...value.values]);
}
export function reCopy(value, seen = new Map()) {
  value = normalizeNil(value);
  if (!dataKind(value)) return value;
  if (seen.has(value)) return seen.get(value);
  const result = copy(value);
  seen.set(value, result);
  if (structInfo(value) || collectionInfo(value)) return result;
  for (const key of Object.keys(result.values)) result.values[key] = reCopy(result.values[key], seen);
  return result;
}

function collection(value) {
  const kind = dataKind(value);
  if (!kind) throw new TypeError('Expected a list, dict, vector, or matrix');
  return kind;
}
function index(key, size) {
  if (!Number.isInteger(key) || key < 0 || key >= size) throw new RangeError('Index must be an integer within bounds');
}
export function get(value, key) {
  if (textureSizes.has(value)) {
    const [width, height] = textureSizes.get(value);
    if (key === 'w') return width;
    if (key === 'h') return height;
    if (key === 'wh') return vector(2, [width, height]);
    throw new TypeError(`Unknown texture field: ${key}`);
  }
  if (structDefinitionInfo(value) || structInfo(value) || collectionInfo(value)) return structuredGet(value, key);
  if (collection(value) !== 'dict') { index(key, value.values.length); return normalizeNil(value.values[key]); }
  if (typeof key !== 'string') throw new TypeError('dict keys must be strings');
  return Object.hasOwn(value.values, key) ? normalizeNil(value.values[key]) : null;
}
export function put(value, key, replacement) {
  if (structDefinitionInfo(value) || structInfo(value) || collectionInfo(value)) return structuredPut(value, key, replacement);
  replacement = languageValue(replacement);
  const kind = collection(value);
  if (kind !== 'dict') {
    index(key, value.values.length);
    if (kind !== 'list' && typeof replacement !== 'number') throw new TypeError('Vector and matrix components must be numbers');
    const info = vectorInfo(kind);
    if (info?.suffix) {
      if (!scalarMatches(replacement, info.scalar === 'f32' ? 'num' : info.scalar)) throw new TypeError(`Expected ${info.scalar} component; use an explicit conversion`);
    }
    value.values[key] = (info?.scalar === 'f32' || /^mat([234])x\1f$/.test(kind)) ? Math.fround(replacement) : replacement;
    return value;
  }
  if (typeof key !== 'string') throw new TypeError('dict keys must be strings');
  value.values[key] = replacement;
  return value;
}
export function insert(target, value, at) {
  if (arguments.length < 2 || arguments.length > 3) throw new TypeError('insert expects a list or many, value, and optional index');
  if (dataKind(target) === 'many') return manyInsert(target, value, arguments.length === 2 ? undefined : at);
  if (dataKind(target) !== 'list') throw new TypeError('insert expects a list or many as its first argument');
  if (arguments.length === 2) at = target.values.length;
  index(at, target.values.length + 1);
  value = languageValue(value);
  target.values.splice(at, 0, value);
  return target;
}
export function remove(target, at) {
  if (arguments.length !== 2) throw new TypeError('remove expects a list or many and index');
  if (dataKind(target) === 'many') return manyRemove(target, at);
  if (dataKind(target) !== 'list') throw new TypeError('remove expects a list or many as its first argument');
  if (at === null) return target;
  index(at, target.values.length);
  target.values.splice(at, 1);
  return target;
}
export function equal(left, right, seen = new Map()) {
  if (Object.is(left, right)) return true;
  const kind = dataKind(left);
  if (!kind || kind !== dataKind(right)) return false;
  if (kind === 'struct' && structInfo(left).definition !== structInfo(right).definition) return false;
  if (kind === 'array' || kind === 'many') {
    const a = collectionInfo(left), b = collectionInfo(right);
    return sameElement(a.element, b.element) && a.length === b.length && Array.from({ length: a.length }, (_, i) => equal(get(left, i), get(right, i), seen)).every(Boolean);
  }
  if (seen.get(left)?.has(right)) return true;
  if (!seen.has(left)) seen.set(left, new Set());
  seen.get(left).add(right);
  if (kind === 'dict' || kind === 'struct') {
    const keys = Object.keys(left.values);
    return keys.length === Object.keys(right.values).length &&
      keys.every(key => Object.hasOwn(right.values, key) && equal(left.values[key], right.values[key], seen));
  }
  return left.values.length === right.values.length && left.values.every((value, i) => equal(value, right.values[i], seen));
}

export function contains(value, target) {
  if (arguments.length !== 2) throw new TypeError('in expects a value or key followed by a list, dict, or many');
  const kind = dataKind(target);
  if (kind === 'many') {
    for (let i = 0; i < collectionInfo(target).length; i++) if (equal(get(target, i), normalizeNil(value))) return true;
    return false;
  }
  if (kind === 'list') return target.values.some(item => equal(item, normalizeNil(value)));
  if (kind === 'dict') {
    if (typeof value !== 'string') throw new TypeError('in: dict keys must be strings');
    return Object.hasOwn(target.values, value);
  }
  throw new TypeError('in expects a list, dict, or many as its second argument');
}

export function where(target, value) {
  if (arguments.length !== 2) throw new TypeError('where expects a list, dict, or many followed by a value');
  value = normalizeNil(value);
  const kind = dataKind(target);
  if (kind === 'many') {
    for (let i = 0; i < collectionInfo(target).length; i++) if (equal(get(target, i), value)) return i;
    return null;
  }
  if (kind === 'list') {
    const found = target.values.findIndex(item => equal(normalizeNil(item), value));
    return found === -1 ? null : found;
  }
  if (kind === 'dict') {
    for (const [key, item] of Object.entries(target.values)) {
      if (equal(normalizeNil(item), value)) return key;
    }
    return null;
  }
  throw new TypeError('where expects a list, dict, or many as its first argument');
}

export function serializeData(value) {
  const active = new Set();
  function validate(value) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return;
    if (!dataKind(value)) throw new TypeError('Value cannot be serialized losslessly as JSON data');
    if (structInfo(value) || collectionInfo(value)) throw new TypeError('Structs, arrays, and many require schema-aware serialization');
    if (active.has(value)) throw new TypeError('Cyclic data cannot be serialized as JSON');
    active.add(value);
    Object.values(value.values).forEach(validate);
    active.delete(value);
  }
  validate(value);
  return JSON.stringify(value);
}
export function deserializeData(text) {
  if (typeof text !== 'string') throw new TypeError('from-json expects a string');
  function restore(value) {
    if (value === null || ['string', 'boolean'].includes(typeof value)) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).length !== 2 || !Object.hasOwn(value, 'type') || !Object.hasOwn(value, 'values')) {
      throw new TypeError('Expected tagged JSON language data');
    }
    if (value.type === 'dict' && value.values && typeof value.values === 'object' && !Array.isArray(value.values)) {
      return dict(...Object.entries(value.values).flatMap(([key, item]) => [key, restore(item)]));
    }
    if (Array.isArray(value.values)) {
      if (value.type === 'list') return list(...value.values.map(restore));
      const info = vectorInfo(value.type);
      if (info && value.values.length === info.size &&
          value.values.every(item => typeof item === 'number' && Number.isFinite(item) && scalarMatches(item, info.scalar))) {
        return vector(info.size, value.values, value.type);
      }
      if (/^mat([234])x\1f$/.test(value.type) && value.values.length === matrixSize(value.type) ** 2 &&
          value.values.every(item => typeof item === 'number' && Number.isFinite(item))) {
        return matrix(matrixSize(value.type), value.values);
      }
    }
    throw new TypeError('Invalid tagged JSON language data');
  }
  return restore(JSON.parse(text));
}

export function cap(value) {
  if (arguments.length !== 1) throw new TypeError('cap expects exactly one list, dict, array, or many');
  const kind = dataKind(value);
  if (kind === 'array' || kind === 'many') return collectionInfo(value).capacity;
  if (kind === 'list') return value.values.length;
  if (kind === 'dict') return Object.keys(value.values).length;
  throw new TypeError('cap expects a list, dict, array, or many');
}

export const dataBindings = {
  list, dict, get, put, insert, remove, where, copy, bool, in: contains, 're-copy': value => reCopy(value), '=': (left, right) => equal(left, right),
  cap,
  len: value => structDefinitionInfo(value) || structInfo(value) || collectionInfo(value) ? structuredLen(value) : collection(value) !== 'dict' ? value.values.length : Object.keys(value.values).length,
  'to-json': serializeData, 'from-json': deserializeData,
};
