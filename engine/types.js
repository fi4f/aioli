import { dataKind, vector, matrix, matrixColumn, registerOpaque, get } from './data.js';
import { put, registerTextureSize } from './data.js';
import { structDefinitionInfo, isCheckedView } from './structures.js';
import { scalarTypes, vectorTypes, vectorInfo, scalarMatches, matrixSize, matrixTypes, typeAliases, canonicalType } from './numeric-types.js';
import { swizzleAccessors, swizzleNames, writableSwizzleNames } from './swizzles.generated.js';
const textures = new WeakSet();

export const typeNames = new Set(['nil', 'bool', 'function', 'list', 'dict', 'struct', 'array', 'many', 'mat2x2f', 'mat3x3f', 'mat4x4f', 'texture2d']);
for (const type of ['num', 'str', ...scalarTypes, ...vectorTypes, ...Object.keys(typeAliases)]) typeNames.add(type);

export function registerTexture(handle, width, height) {
  textures.add(handle);
  if (width !== undefined && height !== undefined) registerTextureSize(handle, width, height);
  return registerOpaque(handle);
}

export function assertType(value, type, label = 'Value') {
  type = canonicalType(type);
  let matches;
  switch (type) {
    case 'num': case 'f32': case 'i32': case 'u32': matches = scalarMatches(value, type); break;
    case 'str': matches = typeof value === 'string'; break;
    case 'nil': matches = value === null; break;
    case 'bool': matches = typeof value === 'boolean'; break;
    case 'function': matches = typeof value === 'function'; break;
    case 'list': case 'dict': case 'struct': case 'array': case 'many': matches = dataKind(value) === type; break;
    case 'mat2x2f': case 'mat3x3f': case 'mat4x4f':
      matches = dataKind(value) === type && value.values.length === matrixSize(type) ** (type.startsWith('mat') ? 2 : 1) &&
        value.values.every(component => typeof component === 'number'); break;
    case 'texture2d': matches = textures.has(value); break;
    default: {
      const info = vectorInfo(type);
      if (!info) throw new TypeError(`Unknown type: ${type}`);
      matches = dataKind(value) === type && value.values.length === info.size && value.values.every(component => scalarMatches(component, info.scalar));
    }
  }
  if (!matches) {
    const actual = value === null ? 'nil' : dataKind(value) || ({ number: 'num', string: 'str', boolean: 'bool' }[typeof value] || typeof value);
    throw new TypeError(`${label}: expected ${type}, received ${actual}${actual === 'str' ? ` ${JSON.stringify(value)}` : ''}`);
  }
  return value;
}

export function parseParameters(nodes, { required = false, types = typeNames, fail } = {}) {
  const result = [];
  for (let i = 0; i < nodes.length;) {
    const node = nodes[i++];
    if (node.kind !== 'symbol') fail('Expected a parameter name', node);
    let annotation = null;
    if (nodes[i]?.kind === 'colon') {
      const colon = nodes[i++];
      annotation = nodes[i++];
      if (annotation?.kind === 'literal' && annotation.value === null) annotation = { ...annotation, kind: 'symbol', name: 'nil' };
      if (annotation?.kind !== 'symbol') fail(`Expected type after ${node.name}:`, annotation || colon);
      if (!types.has(annotation.name)) fail(`Unsupported parameter type: ${annotation.name}; expected ${[...types].join(', ')}`, annotation);
    } else if (required) fail(`Expected colon after parameter ${node.name}`, nodes[i] || node);
    result.push({ name: node.name, type: annotation?.name || null, node,
      start: node.start, end: annotation?.end || node.end });
  }
  return result;
}

export const vectorBindings = {};
for (const type of vectorTypes) {
  const size = vectorInfo(type).size;
  vectorBindings[type] = (...values) => vector(size, values, type);
}
export const typeGuardBindings = Object.fromEntries(['num', 'str', 'list', 'dict', 'array', 'many', ...scalarTypes, ...vectorTypes, ...matrixTypes, ...Object.keys(typeAliases)].map(type => [`${type}?`, (...values) => {
  if (values.length !== 1) throw new TypeError(`${type}? expects exactly one value`);
  try { assertType(values[0], type); return true; } catch (error) { if (error instanceof TypeError) return false; throw error; }
}]));
export const matrixBindings = Object.fromEntries([2, 3, 4].map(size => [`mat${size}x${size}f`, (...values) => matrix(size, values)]));
for (const [alias, type] of Object.entries(typeAliases)) {
  const constructors = alias.startsWith('vec') ? vectorBindings : matrixBindings;
  constructors[alias] = constructors[type];
}
export function swizzle(value, name) {
  if (!swizzleNames.has(name)) throw new TypeError('Invalid vector swizzle');
  const kind = dataKind(value);
  const accessor = swizzleAccessors[kind]?.[name];
  if (!accessor) throw new TypeError(`${name}: expected a vector with these components`);
  assertType(value, kind, 'Swizzle target');
  return accessor.read(value);
}

export function access(value, key, quoted = false) {
  if (textures.has(value)) return get(value, key);
  const kind = dataKind(value);
  if (kind === 'dict' || kind === 'struct' || structDefinitionInfo(value)) return get(value, key);
  if (kind === 'list' || kind === 'array' || kind === 'many') {
    if (quoted || !/^-?\d+$/.test(key)) throw new TypeError('Indexed collection dot access requires an unquoted integer index');
    const index = Number(key);
    if (!Number.isSafeInteger(index)) throw new RangeError('Collection index must be a safe integer within bounds');
    return get(value, index);
  }
  if (vectorInfo(kind)) {
    if (quoted) throw new TypeError('Vector swizzles must be unquoted');
    if (/^-?\d+$/.test(key)) return get(value, Number(key));
    return swizzle(value, key);
  }
  if (/^mat([234])x\1f$/.test(kind || '')) {
    if (quoted || !/^-?\d+$/.test(key)) throw new TypeError('Matrix dot access requires an unquoted column index');
    return matrixColumn(value, Number(key));
  }
  throw new TypeError('Dot access requires a collection, struct, or vector');
}

export function setAccess(value, key, replacement, quoted = false) {
  const kind = dataKind(value);
  if (kind === 'dict' || kind === 'struct' || structDefinitionInfo(value)) { put(value, key, replacement); return replacement; }
  if (kind === 'list' || kind === 'array' || kind === 'many') {
    if (quoted || !/^-?\d+$/.test(key)) throw new TypeError('Dot assignment requires an unquoted integer index');
    put(value, Number(key), replacement); return replacement;
  }
  if (vectorInfo(kind)) {
    if (!quoted && /^-?\d+$/.test(key)) { put(value, Number(key), replacement); return replacement; }
    const accessor = swizzleAccessors[kind][key];
    if (quoted || !writableSwizzleNames.has(key)) throw new TypeError('Writable vector swizzles require distinct components');
    if (!accessor) throw new TypeError(`${key}: expected a vector with these components`);
    assertType(value, kind, 'Swizzle target');
    const type = accessor.replacementType;
    const values = key.length === 1 ? [type === 'f32' ? Math.fround(assertType(replacement, 'num')) : assertType(replacement, type)] : Array.from(assertType(replacement, type).values);
    // Buffer-backed numeric views validate the complete assignment before writing.
    if (isCheckedView(value) && values.some(v => !Number.isFinite(Math.fround(v)))) throw new TypeError('Struct/array components must be finite f32 numbers');
    // Components are validated and snapshotted before any direct destination write.
    accessor.write(value, values);
    return replacement;
  }
  if (/^mat([234])x\1f$/.test(kind || '')) {
    if (quoted || !/^-?\d+$/.test(key)) throw new TypeError('Matrix dot assignment requires an unquoted column index');
    const column = matrixColumn(value, Number(key)), values = Array.from(assertType(replacement, column.type).values);
    if (isCheckedView(value) && values.some(v => !Number.isFinite(Math.fround(v)))) throw new TypeError('Struct/array components must be finite f32 numbers');
    values.forEach((component, row) => put(column, row, component));
    return replacement;
  }
  throw new TypeError('Dot assignment requires a collection, struct, or vector');
}
