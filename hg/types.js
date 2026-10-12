import { TypeBindings } from './type-bindings.generated.js';
import { Data } from './data.js';
import { Promises } from './promises.js';
import { Errors } from './errors.js';
import { Structures } from './structures.js';
import { NumericTypes } from './numeric-types.js';
import { Swizzles } from './swizzles.generated.js';
const __textures__ = new WeakSet();
const __bindings__ = new WeakMap();

const __typeNames__ = new Set([
  'nil',
  'bool',
  'function',
  'promise',
  'error',
  'list',
  'dict',
  'struct',
  'array',
  'many',
  'mat2x2f',
  'mat3x3f',
  'mat4x4f',
  'texture2d',
  'binding',
]);
for (const type of [
  'num',
  'str',
  ...NumericTypes.scalarTypes,
  ...NumericTypes.vectorTypes,
  ...Object.keys(NumericTypes.typeAliases),
])
  __typeNames__.add(type);

function __registerTexture__(handle, width, height) {
  __textures__.add(handle);
  if (width !== undefined && height !== undefined) Data.registerTextureSize(handle, width, height);
  return Data.registerOpaque(handle);
}

function __textureHandle__(width, height) {
  return __registerTexture__({ __type__: '__texture2d__' }, width, height);
}

function __bindingHandle__(name) {
  const handle = { __type__: '__binding__', name };
  __bindings__.set(handle, name);
  return Data.registerOpaque(handle);
}

function __type__(value) {
  if (arguments.length !== 1) throw new TypeError('type expects exactly one value');
  if (value === null || value === undefined) return '__nil__';
  switch (typeof value) {
    case 'number':
      NumericTypes.assertFinite(value, 'type');
      return '__num__';
    case 'string':
      return '__str__';
    case 'boolean':
      return '__bool__';
    case 'function':
      return '__function__';
  }
  if (Promises.isPromise(value)) return '__promise__';
  if (__textures__.has(value)) return '__texture2d__';
  if (__bindings__.has(value)) return '__binding__';
  if (Data.isHostData(value)) return '__dict__';
  const kind = Data.dataKind(value);
  if (kind && __typeNames__.has(kind)) return `__${kind}__`;
  throw new TypeError('type expects a Lisp value');
}

function __assertType__(value, type, label = 'Value') {
  type = NumericTypes.canonicalType(type);
  let matches;
  switch (type) {
    case 'num':
    case 'f32':
    case 'i32':
    case 'u32':
      matches = NumericTypes.scalarMatches(value, type);
      break;
    case 'str':
      matches = typeof value === 'string';
      break;
    case 'nil':
      matches = value === null;
      break;
    case 'bool':
      matches = typeof value === 'boolean';
      break;
    case 'function':
      matches = typeof value === 'function';
      break;
    case 'promise':
      matches = Promises.isPromise(value);
      break;
    case 'error':
      matches = Errors.isError(value);
      break;
    case 'list':
    case 'dict':
    case 'struct':
    case 'array':
    case 'many':
      matches = Data.dataKind(value) === type;
      break;
    case 'mat2x2f':
    case 'mat3x3f':
    case 'mat4x4f':
      matches =
        Data.dataKind(value) === type &&
        Data.values(value).length ===
          NumericTypes.matrixSize(type) ** (type.startsWith('mat') ? 2 : 1) &&
        Data.values(value).every(Number.isFinite);
      break;
    case 'texture2d':
      matches = __textures__.has(value);
      break;
    case 'binding':
      matches = __bindings__.has(value);
      break;
    default: {
      const info = NumericTypes.vectorInfo(type);
      if (!info) throw new TypeError(`Unknown type: ${type}`);
      const components = Data.dataKind(value) === type ? Data.values(value) : null;
      matches =
        components !== null &&
        components.length === info.size &&
        components.every((component) => NumericTypes.scalarMatches(component, info.scalar));
    }
  }
  if (!matches) {
    const actual =
      value === null
        ? 'nil'
        : __textures__.has(value)
          ? 'texture2d'
          : __bindings__.has(value)
            ? 'binding'
            : Data.dataKind(value) ||
              { number: 'num', string: 'str', boolean: 'bool' }[typeof value] ||
              typeof value;
    throw new TypeError(
      `${label}: expected ${type}, received ${actual}${actual === 'str' ? ` ${JSON.stringify(value)}` : ''}`,
    );
  }
  return value;
}

function __parseParameters__(
  nodes,
  { required = false, rest = false, types = __typeNames__, fail } = {},
) {
  const result = [];
  for (let i = 0; i < nodes.length;) {
    let node = nodes[i++];
    const isRest = node.kind === 'symbol' && node.name === '&rest';
    if (isRest) {
      if (!rest) fail('Rest parameters are not supported here', node);
      const marker = node;
      node = nodes[i++];
      if (node?.kind !== 'symbol') fail('Expected a parameter name after &rest', node || marker);
    }
    if (node.kind !== 'symbol') fail('Expected a parameter name', node);
    let annotation = null;
    if (nodes[i]?.kind === 'colon') {
      const colon = nodes[i++];
      annotation = nodes[i++];
      if (annotation?.kind === 'literal' && annotation.value === null)
        annotation = { ...annotation, kind: 'symbol', name: 'nil' };
      if (annotation?.kind !== 'symbol')
        fail(`Expected type after ${node.name}:`, annotation || colon);
      if (!types.has(annotation.name))
        fail(
          `Unsupported parameter type: ${annotation.name}; expected ${[...types].join(', ')}`,
          annotation,
        );
    } else if (required) fail(`Expected colon after parameter ${node.name}`, nodes[i] || node);
    if (isRest && i !== nodes.length) fail('Rest parameter must be last', nodes[i]);
    if (isRest && annotation && annotation.name !== 'list')
      fail('Rest parameter type must be list', annotation);
    result.push({
      name: node.name,
      type: annotation?.name || null,
      rest: isRest,
      node,
      start: node.start,
      end: annotation?.end || node.end,
    });
  }
  return result;
}

const __vectorBindings__ = TypeBindings.vectors;
const __matrixBindings__ = TypeBindings.matrices;
const __typeGuardBindings__ = TypeBindings.guards;
function __swizzle__(value, name) {
  if (!Swizzles.names.has(name)) throw new TypeError('Invalid vector swizzle');
  const kind = Data.dataKind(value);
  const accessor = Swizzles.accessors[kind]?.[name];
  if (!accessor) throw new TypeError(`${name}: expected a vector with these components`);
  __assertType__(value, kind, 'Swizzle target');
  return accessor.read(value);
}

function __computedSelector__(value, key) {
  const kind = Data.dataKind(value);
  if (
    Data.isHostData(value) ||
    __textures__.has(value) ||
    __bindings__.has(value) ||
    kind === 'dict' ||
    kind === 'error' ||
    kind === 'struct' ||
    Structures.structDefinitionInfo(value)
  ) {
    if (typeof key !== 'string') throw new TypeError('Computed field keys must be strings');
    return { key, quoted: true };
  }
  if (
    kind === 'list' ||
    kind === 'array' ||
    kind === 'many' ||
    NumericTypes.vectorInfo(kind) ||
    NumericTypes.matrixSize(kind)
  ) {
    if (typeof key !== 'number' || !Number.isInteger(key))
      throw new TypeError('Computed indices must be integer numbers');
    if (!Number.isSafeInteger(key)) throw new RangeError('Computed index must be a safe integer');
    return { key: String(key), quoted: false };
  }
  throw new TypeError('Computed access requires a collection, struct, vector, or matrix');
}

function __computedAccess__(value, key) {
  const selector = __computedSelector__(value, key);
  return __access__(value, selector.key, selector.quoted);
}

function __setComputedAccess__(value, key, replacement) {
  const selector = __computedSelector__(value, key);
  return __setAccess__(value, selector.key, replacement, selector.quoted);
}

function __access__(value, key, quoted = false) {
  if (Data.isHostData(value)) return Data.get(value, key);
  if (__bindings__.has(value)) {
    if (key === '__type__') return '__binding__';
    if (key === 'name') return __bindings__.get(value);
    throw new TypeError(`Unknown binding field: ${key}`);
  }
  if (__textures__.has(value)) {
    if (key === '__type__') return '__texture2d__';
    return Data.get(value, key);
  }
  const kind = Data.dataKind(value);
  if (
    kind === 'dict' ||
    kind === 'error' ||
    kind === 'struct' ||
    Structures.structDefinitionInfo(value)
  )
    return Data.get(value, key);
  if (kind === 'list' || kind === 'array' || kind === 'many') {
    if (quoted || !/^-?\d+$/.test(key))
      throw new TypeError('Indexed collection dot access requires an unquoted integer index');
    const index = Number(key);
    if (!Number.isSafeInteger(index))
      throw new RangeError('Collection index must be a safe integer within bounds');
    return Data.get(value, index);
  }
  if (NumericTypes.vectorInfo(kind)) {
    if (quoted) throw new TypeError('Vector swizzles must be unquoted');
    if (/^-?\d+$/.test(key)) return Data.get(value, Number(key));
    return __swizzle__(value, key);
  }
  if (/^mat([234])x\1f$/.test(kind || '')) {
    if (quoted || !/^-?\d+$/.test(key))
      throw new TypeError('Matrix dot access requires an unquoted column index');
    return Data.matrixColumn(value, Number(key));
  }
  throw new TypeError('Dot access requires a collection, struct, or vector');
}

function __setAccess__(value, key, replacement, quoted = false) {
  if (Data.isHostData(value)) {
    Data.put(value, key, replacement);
    return replacement;
  }
  const kind = Data.dataKind(value);
  if (
    kind === 'dict' ||
    kind === 'error' ||
    kind === 'struct' ||
    Structures.structDefinitionInfo(value)
  ) {
    Data.put(value, key, replacement);
    return replacement;
  }
  if (kind === 'list' || kind === 'array' || kind === 'many') {
    if (quoted || !/^-?\d+$/.test(key))
      throw new TypeError('Dot assignment requires an unquoted integer index');
    Data.put(value, Number(key), replacement);
    return replacement;
  }
  if (NumericTypes.vectorInfo(kind)) {
    if (!quoted && /^-?\d+$/.test(key)) {
      Data.put(value, Number(key), replacement);
      return replacement;
    }
    const accessor = Swizzles.accessors[kind][key];
    if (quoted || !Swizzles.writableNames.has(key))
      throw new TypeError('Writable vector swizzles require distinct components');
    if (!accessor) throw new TypeError(`${key}: expected a vector with these components`);
    __assertType__(value, kind, 'Swizzle target');
    const type = accessor.replacementType;
    const values =
      key.length === 1
        ? [
            type === 'f32'
              ? Math.fround(__assertType__(replacement, 'num'))
              : __assertType__(replacement, type),
          ]
        : Array.from(Data.values(__assertType__(replacement, type)));
    // Buffer-backed numeric views validate the complete assignment before writing.
    if (Structures.isCheckedView(value) && values.some((v) => !Number.isFinite(Math.fround(v))))
      throw new TypeError('Struct/array components must be finite f32 numbers');
    // Components are validated and snapshotted before any direct destination write.
    accessor.write(value, values);
    return replacement;
  }
  if (/^mat([234])x\1f$/.test(kind || '')) {
    if (quoted || !/^-?\d+$/.test(key))
      throw new TypeError('Matrix dot assignment requires an unquoted column index');
    const column = Data.matrixColumn(value, Number(key)),
      values = Array.from(Data.values(__assertType__(replacement, Data.dataKind(column))));
    if (Structures.isCheckedView(value) && values.some((v) => !Number.isFinite(Math.fround(v))))
      throw new TypeError('Struct/array components must be finite f32 numbers');
    values.forEach((component, row) => Data.put(column, row, component));
    return replacement;
  }
  throw new TypeError('Dot assignment requires a collection, struct, or vector');
}

export const Types = {
  typeNames: __typeNames__,
  type: __type__,
  registerTexture: __registerTexture__,
  textureHandle: __textureHandle__,
  bindingHandle: __bindingHandle__,
  assertType: __assertType__,
  parseParameters: __parseParameters__,
  vectorBindings: __vectorBindings__,
  typeGuardBindings: __typeGuardBindings__,
  matrixBindings: __matrixBindings__,
  swizzle: __swizzle__,
  access: __access__,
  setAccess: __setAccess__,
  computedAccess: __computedAccess__,
  setComputedAccess: __setComputedAccess__,
};
