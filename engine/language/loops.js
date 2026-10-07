import { dataKind, get } from './data.js';
import { collectionInfo } from './structures.js';

export function loopInteger(value) {
  if (!Number.isSafeInteger(value)) throw new TypeError('Loop bounds must be finite safe integers');
  return value;
}
export function loopCount(value) {
  loopInteger(value);
  if (value < 0) throw new RangeError('Loop count must be nonnegative');
  return value;
}
export function loopCollection(value) {
  const kind = dataKind(value);
  if (!['list', 'array', 'many'].includes(kind)) throw new TypeError('for expects a list, array or many');
  const length = kind === 'list' ? value.values.length : collectionInfo(value).length;
  return { value: Array.from({ length }, (_, i) => get(value, i)), length };
}
export const loopRuntime = { integer: loopInteger, count: loopCount, collection: loopCollection, get: (items, index) => items[index] };
loopRuntime.range = (from, to) => ({ from: loopInteger(from), to: loopInteger(to), step: from < to ? 1 : -1, range: true });
loopRuntime.for = value => {
  if (typeof value === 'number') return loopRuntime.range(0, loopCount(value));
  const collection = loopCollection(value);
  return { ...collection, from: 0, to: collection.length, step: 1, range: false };
};
