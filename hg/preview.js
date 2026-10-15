import { Data } from './data.js';
import { Types } from './types.js';
import { Structures } from './structures.js';
import { NumericTypes } from './numeric-types.js';

// Shallow, bounded observations of live data. Never call functions or accessors.
function __field__(value, key) {
  const field = Object.getOwnPropertyDescriptor(value, key);
  if (!field) throw new Error('Field no longer exists');
  if (!Object.hasOwn(field, 'value')) throw new Error('Accessor is not evaluated');
  return field.value;
}

function __read__(value, key) {
  const kind = Data.dataKind(value);
  const cells = Data.bindingCells(value);
  if (cells) return __field__(__field__(cells, key), 'value');
  if (Data.isHostData(value) || kind === 'dict' || kind === 'error') return __field__(value, key);
  if (kind === 'list' && Number.isSafeInteger(key) && key >= 0 && key < value.length && Object.hasOwn(value, key))
    return __field__(value, key);
  if (NumericTypes.matrixSize(kind)) return Data.matrixColumn(value, key);
  if (NumericTypes.vectorInfo(kind) && typeof key === 'string') return Types.access(value, key);
  if (!kind) return Types.access(value, String(key));
  return Data.get(value, key);
}

export const Preview = {
  describe(value, path = [], limit = 50, offset = 0) {
    if (!Array.isArray(path) || path.length > 32 ||
      path.some(key => typeof key !== 'string' && !Number.isSafeInteger(key)))
      throw new TypeError('Preview path expects at most 32 string or integer keys');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500)
      throw new TypeError('Preview limit must be between 1 and 500');
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw new TypeError('Preview offset must be a nonnegative integer');
    try {
      const ancestors = new Set();
      for (const key of path) {
        ancestors.add(value);
        value = __read__(value, key);
      }
      if (value === undefined) value = null;
      let type;
      try { type = Types.type(value); } catch { type = '__opaque__'; }
      const name = type.slice(2, -2), kind = Data.dataKind(value);
      let keys = [], count = 0;
      const cells = Data.bindingCells(value), struct = Structures.structInfo(value);
      if (cells || Data.isHostData(value) || kind === 'dict' || kind === 'error') {
        keys = Object.keys(cells ?? value);
        count = keys.length;
      } else if (struct) {
        keys = struct.definition.fields.map(field => field.key);
        count = keys.length;
      } else if (NumericTypes.vectorInfo(kind)) {
        count = NumericTypes.vectorInfo(kind).size;
        keys = ['x', 'y', 'z', 'w'].slice(0, count);
      } else if (kind === 'list' || kind === 'array' || kind === 'many' || NumericTypes.matrixSize(kind)) {
        count = NumericTypes.matrixSize(kind) || Data.dataBindings.len(value);
        keys = Array.from({ length: Math.min(Math.max(0, count - offset), limit) }, (_, index) => index + offset);
      } else if (type === '__texture2d__') {
        keys = ['w', 'h']; count = keys.length;
      } else if (type === '__binding__') {
        keys = ['name']; count = keys.length;
      }
      const circular = value !== null && typeof value === 'object' && ancestors.has(value);
      let preview = name;
      if (value == null) preview = 'nil';
      else if (typeof value === 'string')
        preview = JSON.stringify(value.slice(0, 160)) + (value.length > 160 ? '…' : '');
      else if (typeof value === 'number' || typeof value === 'boolean') preview = String(value);
      else if (count || kind === 'dict' || kind === 'list' || kind === 'array' || kind === 'many')
        preview = `${name} (${count})`;
      if (circular) preview += ' — circular reference';
      const indexed = kind === 'list' || kind === 'array' || kind === 'many' ||
        NumericTypes.matrixSize(kind);
      return { type, preview, keys: circular ? [] : indexed ? keys : keys.slice(offset, offset + limit), count, circular };
    } catch (error) {
      return { type: '__unavailable__', preview: `Unavailable: ${error.message}`.slice(0, 180),
        keys: [], count: 0, circular: false };
    }
  },
};
