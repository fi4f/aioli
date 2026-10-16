import { Data } from './data.js';
import { Structures } from './structures.js';

function __loopInteger__(value) {
  if (!Number.isSafeInteger(value)) throw new TypeError('Loop bounds must be finite safe integers');
  return value;
}
function __loopCount__(value) {
  __loopInteger__(value);
  if (value < 0) throw new RangeError('Loop count must be nonnegative');
  return value;
}
function __loopCollection__(value) {
  const kind = Data.dataKind(value);
  if (!['list', 'array', 'many'].includes(kind))
    throw new TypeError('for expects a list, array or many');
  const length = kind === 'list' ? value.length : Structures.collectionInfo(value).length;
  const snapshot = kind === 'list'
    ? Array.from(Data.values(value), Data.normalizeNil)
    : Array.from({ length }, (_, i) => Data.get(value, i));
  return { value: snapshot, length };
}
const __loopRuntime__ = {
  integer: __loopInteger__,
  count: __loopCount__,
  collection: __loopCollection__,
  get: (items, index) => items[index],
};
__loopRuntime__.range = (from, to) => ({
  from: __loopInteger__(from),
  to: __loopInteger__(to),
  step: from < to ? 1 : -1,
  range: true,
});
__loopRuntime__.for = (value) => {
  if (typeof value === 'number') return __loopRuntime__.range(0, __loopCount__(value));
  const collection = __loopCollection__(value);
  return { ...collection, from: 0, to: collection.length, step: 1, range: false };
};

export const Loops = {
  loopInteger: __loopInteger__,
  loopCount: __loopCount__,
  loopCollection: __loopCollection__,
  runtime: __loopRuntime__,
};
